/**
 * V30 — the mask, tested without a model.
 *
 * Everything the logits processor does apart from touching a tensor is pure:
 * a vocabulary in byte-level form, a grammar, and the set of token ids that
 * keep the answer inside it. All of that runs in CI in milliseconds; only the
 * 355 MB of weights needs a GPU or a long CPU run, and that lives in
 * `bench.node.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  allowedTokens,
  buildVocabIndex,
  createGrammarProcessor,
  generatedBytes,
  readVocab,
  type LogitsProcessorLike,
  type LogitsTensor,
} from '@/features/ai/llm/constrain';
import { buildGrammar } from '@/features/ai/llm/grammar';
import { BENCH_COLUMNS } from '@/features/ai/llm/corpus';

/**
 * The GPT-2 byte→unicode table, written out here independently of the module
 * under test: if both used the same helper, a wrong table would agree with
 * itself and the tests would pass on it.
 */
function spell(text: string): string {
  const direct: number[] = [];
  for (let b = 0x21; b <= 0x7e; b++) direct.push(b);
  for (let b = 0xa1; b <= 0xac; b++) direct.push(b);
  for (let b = 0xae; b <= 0xff; b++) direct.push(b);
  const moved = new Map<number, number>();
  let next = 0;
  for (let b = 0; b < 256; b++) {
    if (direct.includes(b)) continue;
    moved.set(b, 256 + next);
    next += 1;
  }
  let out = '';
  for (const byte of new TextEncoder().encode(text)) {
    out += String.fromCodePoint(moved.get(byte) ?? byte);
  }
  return out;
}

/** A tiny vocabulary: id 0 is end-of-turn, the rest are content. */
const PIECES = [
  '<|im_end|>',
  '{',
  '"kind"',
  ':',
  '"shape"',
  '"count"',
  '"miss',
  'ing"',
  '}',
  ' ',
  '```',
  'json',
  '"med',
  'ian"',
  '"région"',
  '"Île-de-France"',
];
const VOCAB = PIECES.map((piece, i) => (i === 0 ? piece : spell(piece)));
const EOS = [0];
const index = buildVocabIndex(VOCAB, EOS);
const grammar = buildGrammar(BENCH_COLUMNS);
const id = (piece: string) => PIECES.indexOf(piece);
const encoder = new TextEncoder();

describe('index du vocabulaire', () => {
  it('rend chaque jeton en octets, sauf ceux de fin de tour', () => {
    expect(index.usable).toBe(PIECES.length - 1);
    expect(index.bytes[id('<|im_end|>')]).toBeNull();
    expect([...index.bytes[id('{')]!]).toEqual([...encoder.encode('{')]);
    // A multi-byte character survives, which is the reason the automaton walks
    // bytes rather than characters.
    expect([...index.bytes[id('"région"')]!]).toEqual([...encoder.encode('"région"')]);
  });

  it('range les jetons par premier octet', () => {
    expect(index.byFirstByte[0x7b]).toContain(id('{'));
    expect(index.byFirstByte[0x22]).toContain(id('"kind"'));
  });

  it('recolle les octets déjà générés', () => {
    const bytes = generatedBytes(index, [id('{'), id('"kind"'), id(':')]);
    expect(new TextDecoder().decode(bytes)).toBe('{"kind":');
  });
});

describe('jetons autorisés', () => {
  it("n'ouvre la réponse que par une accolade", () => {
    const ids = allowedTokens(grammar, index, new Uint8Array());
    expect(ids).toEqual([id('{')]);
    // The two failure modes measured in V27 — a markdown fence and a leading
    // space — are simply not choosable.
    expect(ids).not.toContain(id('```'));
    expect(ids).not.toContain(id(' '));
  });

  it('ne propose que des formes réelles après la clé kind', () => {
    const ids = allowedTokens(grammar, index, encoder.encode('{"kind":'));
    expect(ids).toContain(id('"shape"'));
    expect(ids).toContain(id('"count"'));
    expect(ids).toContain(id('"miss'));
    // `median` is an operator, never a kind. V27 emitted {"kind":"median"} and
    // the answer was thrown away; here the token cannot be picked at all.
    expect(ids).not.toContain(id('"med'));
  });

  it('exige la fin de tour dès que la requête est complète', () => {
    const ids = allowedTokens(grammar, index, encoder.encode('{"kind":"shape"}'));
    expect(ids).toEqual(EOS);
  });

  it('permet de finir ou de continuer quand les deux sont légaux', () => {
    const ids = allowedTokens(grammar, index, encoder.encode('{"kind":"count"'));
    expect(ids).toContain(id('}'));
    expect(ids).not.toContain(EOS[0]);
  });

  it('finit le tour plutôt que de rester coincé sur une impasse', () => {
    // Not reachable through the automaton, but if it ever were, ending the
    // turn keeps the run finite and the answer becomes an honest refusal.
    const ids = allowedTokens(grammar, index, encoder.encode('{"kind":"zzz'));
    expect(ids).toEqual(EOS);
  });
});

describe('processeur de logits', () => {
  class FakeBase implements LogitsProcessorLike {
    _call(_inputIds: bigint[][], logits: LogitsTensor): LogitsTensor {
      return logits;
    }
  }

  function run(prompt: number[], generated: number[]): Float32Array {
    const processor = createGrammarProcessor(FakeBase, grammar, index);
    const data = new Float32Array(VOCAB.length).fill(1);
    const logits: LogitsTensor = { data, dims: [1, VOCAB.length] };
    const ids = [...prompt, ...generated].map((value) => BigInt(value));
    // First call carries the prompt alone — that is how the processor learns
    // where the prompt ends.
    processor._call([prompt.map((value) => BigInt(value))], {
      data: new Float32Array(VOCAB.length).fill(1),
      dims: [1, VOCAB.length],
    });
    processor._call([ids], logits);
    return data;
  }

  it('rend le tenseur — la bibliothèque chaîne les processeurs', () => {
    const processor = createGrammarProcessor(FakeBase, grammar, index);
    const logits: LogitsTensor = { data: new Float32Array(VOCAB.length), dims: [1, VOCAB.length] };
    expect(processor._call([[]], logits)).toBe(logits);
  });

  it('laisse passer ce qui est légal et coupe le reste', () => {
    const data = run([9, 9, 9], [id('{'), id('"kind"'), id(':')]);
    expect(data[id('"shape"')]).toBe(1);
    expect(data[id('"count"')]).toBe(1);
    expect(data[id('"med')]).toBe(-Infinity);
    expect(data[id('```')]).toBe(-Infinity);
  });

  it('garde la préférence du modèle entre les suites légales', () => {
    // Masking is a veto, not a vote: an allowed token keeps its own score.
    const processor = createGrammarProcessor(FakeBase, grammar, index);
    const data = new Float32Array(VOCAB.length).fill(0);
    data[id('"shape"')] = 3.5;
    data[id('"count"')] = 1.25;
    const logits: LogitsTensor = { data, dims: [1, VOCAB.length] };
    const ids = [id('{'), id('"kind"'), id(':')].map((value) => BigInt(value));
    processor._call([[]], { data: new Float32Array(VOCAB.length), dims: [1, VOCAB.length] });
    processor._call([ids], logits);
    expect(data[id('"shape"')]).toBe(3.5);
    expect(data[id('"count"')]).toBe(1.25);
  });
});

describe('lecture du vocabulaire du tokenizer', () => {
  it('accepte les deux formes que la bibliothèque a utilisées', () => {
    const asObject = readVocab({
      _tokenizerJSON: { model: { vocab: { '{': 1, '"kind"': 0 } } },
      all_special_ids: [5],
      eos_token_id: 5,
    });
    expect(asObject?.vocab).toEqual(['"kind"', '{']);
    expect(asObject?.eosIds).toEqual([5]);
    const asArray = readVocab({ _tokenizer: { model: { vocab: ['a', 'b'] } }, eos_token_id: 1 });
    expect(asArray?.vocab).toEqual(['a', 'b']);
  });

  it("renvoie null quand le vocabulaire n'est pas exposé", () => {
    // Constrained decoding is then announced as OFF rather than silently
    // skipped: an unconstrained answer badged as constrained would be a lie.
    expect(readVocab({})).toBeNull();
    expect(readVocab({ _tokenizerJSON: { model: { vocab: {} } } })).toBeNull();
  });
});

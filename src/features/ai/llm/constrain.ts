/**
 * V30 — the hand-written logits processor: the grammar, applied DURING
 * generation rather than checked after it.
 *
 * At every step the model proposes a probability for each of Qwen's 151 669
 * tokens. This masks out every token that would take the answer outside the
 * query grammar, so `{"kind":"` can only be followed by one of the eight
 * shapes, `"column":` only by a column the table actually has, and a filter
 * value only by something that column can hold. The model still chooses — it
 * simply cannot choose something unwritable.
 *
 * Two implementation notes that are the difference between working and
 * unusably slow:
 *
 * 1. **Tokens are runs of BYTES, taken from the vocabulary's byte-level BPE
 *    form.** `decode()` would give text, and text loses the 1 457 tokens that
 *    are fragments of a multi-byte character. The GPT-2 byte↔unicode table
 *    below is the exact inverse of the encoding the vocabulary file uses.
 * 2. **Candidates are bucketed by first byte.** Walking all 151 669 tokens at
 *    every step would cost more than the model does. The automaton first says
 *    which bytes may come next — usually one or two — and only those buckets
 *    are tested.
 */
import {
  accepting,
  allowedBytes,
  startState,
  stepByte,
  stepBytes,
  type Grammar,
} from '@/features/ai/llm/grammar';

/**
 * GPT-2's byte↔unicode table, the encoding every byte-level BPE vocabulary is
 * written in: printable ASCII and Latin-1 keep their own code point, and the
 * remaining 68 bytes are moved to U+0100 and up so that no vocabulary entry
 * ever contains a control character.
 */
function byteDecoder(): Map<string, number> {
  const direct: number[] = [];
  for (let b = 0x21; b <= 0x7e; b++) direct.push(b);
  for (let b = 0xa1; b <= 0xac; b++) direct.push(b);
  for (let b = 0xae; b <= 0xff; b++) direct.push(b);
  const map = new Map<string, number>();
  for (const b of direct) map.set(String.fromCodePoint(b), b);
  let next = 0;
  for (let b = 0; b < 256; b++) {
    if (direct.includes(b)) continue;
    map.set(String.fromCodePoint(256 + next), b);
    next += 1;
  }
  return map;
}

export interface VocabIndex {
  /** Byte form of each token id; null for a token that may never appear. */
  bytes: (Uint8Array | null)[];
  /** Token ids by first byte — 256 buckets, most of them empty. */
  byFirstByte: number[][];
  /** Ids that end the turn. Allowed only where the grammar is complete. */
  eosIds: number[];
  /** How many ids carry usable bytes — reported so a broken vocab is visible. */
  usable: number;
}

/**
 * Builds the index from the raw vocabulary, in the byte-level form the
 * tokenizer file stores. A token whose spelling contains a character outside
 * the table is a special token (`<|im_end|>` and friends) and is excluded from
 * the content vocabulary — it can only ever be chosen as an end-of-turn.
 */
export function buildVocabIndex(vocab: readonly string[], eosIds: readonly number[]): VocabIndex {
  const decoder = byteDecoder();
  const bytes: (Uint8Array | null)[] = new Array(vocab.length).fill(null);
  const byFirstByte: number[][] = Array.from({ length: 256 }, () => []);
  const eos = new Set(eosIds);
  let usable = 0;

  for (let id = 0; id < vocab.length; id++) {
    if (eos.has(id)) continue;
    const spelling = vocab[id];
    if (typeof spelling !== 'string' || spelling.length === 0) continue;
    const out = new Uint8Array(spelling.length);
    let length = 0;
    let ok = true;
    for (const char of spelling) {
      const byte = decoder.get(char);
      if (byte === undefined) {
        ok = false;
        break;
      }
      out[length++] = byte;
    }
    if (!ok || length === 0) continue;
    const trimmed = out.subarray(0, length);
    bytes[id] = trimmed;
    byFirstByte[trimmed[0]].push(id);
    usable += 1;
  }
  return { bytes, byFirstByte, eosIds: [...eosIds], usable };
}

/**
 * The ids that keep the answer inside the grammar, given what has been
 * generated so far. When the answer is already complete, ending the turn is
 * allowed too — and when it is complete and nothing may follow, ending is the
 * only thing allowed, which is what stops the model from writing a second
 * object after the first.
 */
export function allowedTokens(
  grammar: Grammar,
  index: VocabIndex,
  generated: Uint8Array,
): number[] {
  let state = startState(grammar);
  state = stepBytes(grammar, state, generated);
  const ids: number[] = [];
  if (state.size === 0) return index.eosIds.slice();
  for (const byte of allowedBytes(grammar, state)) {
    // The first byte is stepped ONCE for the whole bucket, not once per token.
    // At `{"kind":"` the state holds seventy positions and the bucket holds
    // thousands of tokens; repeating that first step per token was measured at
    // 53 ms for this single position, against 3 ms for the whole rest.
    const afterFirst = stepByte(grammar, state, byte);
    for (const id of index.byFirstByte[byte]) {
      const token = index.bytes[id];
      if (!token) continue;
      if (token.length === 1) {
        ids.push(id);
        continue;
      }
      if (stepBytes(grammar, afterFirst, token.subarray(1)).size > 0) ids.push(id);
    }
  }
  if (accepting(grammar, state)) ids.push(...index.eosIds);
  // A dead end can only happen if the grammar admits a prefix with no
  // continuation at all. Ending the turn keeps the run finite; the answer then
  // fails `validateIntent` and becomes an honest refusal.
  return ids.length > 0 ? ids : index.eosIds.slice();
}

/** The bytes generated so far, from the ids the model has already chosen. */
export function generatedBytes(index: VocabIndex, ids: readonly number[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const id of ids) {
    const token = index.bytes[id];
    if (!token) continue;
    parts.push(token);
    total += token.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The minimum of a transformers.js Tensor this module touches. */
export interface LogitsTensor {
  data: Float32Array | Float64Array;
  dims: number[];
}

/**
 * The library chains processors — `toReturn = processor(ids, toReturn)` — so
 * `_call` MUST hand the tensor back. Returning nothing leaves the next
 * processor, and then the sampler, holding `undefined`.
 */
export interface LogitsProcessorLike {
  _call(inputIds: bigint[][], logits: LogitsTensor): LogitsTensor;
}

/**
 * Builds the processor. `Base` is the library's own `LogitsProcessor` class,
 * passed in rather than imported: this module must stay out of the main bundle,
 * and the library is only ever loaded on demand.
 *
 * The prompt length is learned rather than passed. The first call carries the
 * prompt and nothing else, so whatever arrives then is the prompt — which also
 * makes the processor correct if it is reused for a second generation.
 */
export function createGrammarProcessor(
  Base: new () => LogitsProcessorLike,
  grammar: Grammar,
  index: VocabIndex,
): LogitsProcessorLike {
  let promptLength = -1;
  return new (class extends Base {
    _call(inputIds: bigint[][], logits: LogitsTensor): LogitsTensor {
      if (promptLength < 0) promptLength = inputIds[0]?.length ?? 0;
      const vocabSize = logits.dims[logits.dims.length - 1];
      const data = logits.data;
      for (let batch = 0; batch < inputIds.length; batch++) {
        const row = inputIds[batch] ?? [];
        const generated = row.slice(promptLength).map((id) => Number(id));
        const ids = allowedTokens(grammar, index, generatedBytes(index, generated));
        const start = batch * vocabSize;
        // Save, blank, restore: the allowed logits keep their own values, so
        // the model's own preference still decides between the legal
        // continuations. Masking is a veto, never a vote.
        const keep = new Float64Array(ids.length);
        for (let i = 0; i < ids.length; i++) keep[i] = data[start + ids[i]];
        data.fill(-Infinity, start, start + vocabSize);
        for (let i = 0; i < ids.length; i++) data[start + ids[i]] = keep[i];
      }
      return logits;
    }
  })();
}

/**
 * Digs the byte-level vocabulary out of a loaded tokenizer.
 *
 * transformers.js keeps the parsed `tokenizer.json` on the instance, which is
 * the form we want: an object mapping each token's byte-level spelling to its
 * id. Two shapes are accepted because the library has used both, and a
 * tokenizer that offers neither returns null — the caller then announces that
 * constrained decoding is off rather than silently generating unconstrained.
 */
export function readVocab(tokenizer: unknown): { vocab: string[]; eosIds: number[] } | null {
  const owner = tokenizer as {
    _tokenizerJSON?: { model?: { vocab?: unknown } };
    _tokenizer?: { model?: { vocab?: unknown }; all_special_ids?: number[] };
    all_special_ids?: number[];
    eos_token_id?: number;
  };
  const raw = owner._tokenizerJSON?.model?.vocab ?? owner._tokenizer?.model?.vocab;
  let vocab: string[] | null = null;
  if (Array.isArray(raw)) {
    vocab = raw.map((entry) => (typeof entry === 'string' ? entry : ''));
  } else if (raw && typeof raw === 'object') {
    const entries = Object.entries(raw as Record<string, number>);
    const size = entries.reduce((max, [, id]) => Math.max(max, id), -1) + 1;
    if (size > 0) {
      const built = new Array<string>(size).fill('');
      for (const [token, id] of entries) built[id] = token;
      vocab = built;
    }
  }
  if (!vocab || vocab.length === 0) return null;

  // Every special id ends the content, not just the configured EOS: a model
  // that emits <|im_end|> or <|endoftext|> has stopped either way.
  const specials = owner.all_special_ids ?? owner._tokenizer?.all_special_ids ?? [];
  const eosIds = [
    ...new Set([...(specials ?? []), ...(owner.eos_token_id != null ? [owner.eos_token_id] : [])]),
  ]
    .filter((id) => typeof id === 'number' && id >= 0)
    .sort((a, b) => a - b);
  return { vocab, eosIds };
}

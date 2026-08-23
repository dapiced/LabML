import { describe, it, expect } from 'vitest';
import {
  buildGrammar,
  isComplete,
  isLegalPrefix,
  startState,
  step,
  MAX_FILTER_COLUMNS,
} from '@/features/ai/llm/grammar';
import { validateIntent } from '@/features/ai/llm/prompt';
import { BENCH_COLUMNS } from '@/features/ai/llm/corpus';
import type { ColumnInfo } from '@/features/ai/chat/parser';

const grammar = buildGrammar(BENCH_COLUMNS);

/** Every character the automaton would allow next, over the printable ASCII set. */
function allowedNext(text: string): string[] {
  let state = startState(grammar);
  for (const char of text) state = step(grammar, state, char);
  const allowed: string[] = [];
  for (let code = 32; code < 127; code++) {
    const char = String.fromCharCode(code);
    if (step(grammar, state, char).size > 0) allowed.push(char);
  }
  return allowed;
}

describe('grammaire — ce qui est écrivable', () => {
  it('accepte les sept formes de la grammaire', () => {
    for (const text of [
      '{"kind":"shape"}',
      '{"kind":"missing"}',
      '{"kind":"none"}',
      '{"kind":"count"}',
      '{"kind":"distribution","column":"class"}',
      '{"kind":"correlation","a":"age","b":"fare"}',
      '{"kind":"aggregate","op":"mean","column":"age"}',
      '{"kind":"aggregate","op":"mean","column":"fare","groupBy":"sex"}',
      '{"kind":"topk","groupBy":"deck","k":3,"op":"count"}',
      '{"kind":"topk","groupBy":"deck","k":5,"op":"mean","column":"fare"}',
    ]) {
      expect(isComplete(grammar, text), text).toBe(true);
    }
  });

  it('accepte les filtres, typés par leur propre colonne', () => {
    for (const text of [
      '{"kind":"count","filter":{"column":"sex","op":"=","value":"female"}}',
      '{"kind":"count","filter":{"column":"age","op":">","value":60}}',
      '{"kind":"count","filter":{"column":"age","op":"<","value":10}}',
      '{"kind":"count","filter":{"column":"fare","op":">=","value":-12.5}}',
      '{"kind":"aggregate","op":"mean","column":"age","filter":{"column":"sex","op":"=","value":"male"}}',
      '{"kind":"aggregate","op":"mean","column":"fare","groupBy":"class","filter":{"column":"alive","op":"!=","value":"no"}}',
    ]) {
      expect(isComplete(grammar, text), text).toBe(true);
    }
  });

  it("refuse une valeur que la colonne n'a pas", () => {
    // `sex` holds male and female. « femme » is not one of them, and under the
    // constraint it is not merely refused after the fact: it cannot be typed.
    expect(
      isLegalPrefix(grammar, '{"kind":"count","filter":{"column":"sex","op":"=","value":"f'),
    ).toBe(true);
    expect(
      isLegalPrefix(grammar, '{"kind":"count","filter":{"column":"sex","op":"=","value":"fe'),
    ).toBe(true);
    expect(
      isLegalPrefix(grammar, '{"kind":"count","filter":{"column":"sex","op":"=","value":"femm'),
    ).toBe(false);
  });

  it('refuse une colonne inventée dès la première lettre qui diverge', () => {
    expect(isLegalPrefix(grammar, '{"kind":"distribution","column":"cl')).toBe(true);
    expect(isLegalPrefix(grammar, '{"kind":"distribution","column":"cli')).toBe(false);
  });

  it('refuse un seuil ordonné sur une colonne de texte', () => {
    // `>` between two strings is not a comparison — the same rule V27.3 had to
    // enforce after the fact, enforced here before a character is written.
    expect(isLegalPrefix(grammar, '{"kind":"count","filter":{"column":"sex","op":">')).toBe(false);
    expect(isLegalPrefix(grammar, '{"kind":"count","filter":{"column":"age","op":">')).toBe(true);
  });

  it('refuse un nombre incomplet et un k hors bornes', () => {
    expect(
      isComplete(grammar, '{"kind":"count","filter":{"column":"age","op":">","value":-}}'),
    ).toBe(false);
    expect(
      isComplete(grammar, '{"kind":"count","filter":{"column":"age","op":">","value":1.}}'),
    ).toBe(false);
    expect(isComplete(grammar, '{"kind":"topk","groupBy":"deck","k":50,"op":"count"}')).toBe(true);
    expect(isComplete(grammar, '{"kind":"topk","groupBy":"deck","k":51,"op":"count"}')).toBe(false);
    expect(isComplete(grammar, '{"kind":"topk","groupBy":"deck","k":0,"op":"count"}')).toBe(false);
  });

  it('interdit tout ce qui suit une requête complète', () => {
    expect(isLegalPrefix(grammar, '{"kind":"shape"} ')).toBe(false);
    expect(isLegalPrefix(grammar, '```json')).toBe(false);
    expect(isLegalPrefix(grammar, ' {')).toBe(false);
    expect(isLegalPrefix(grammar, '{"kind":"shape"}{')).toBe(false);
  });

  it('ne laisse que sept suites après {"kind":"', () => {
    // The claim V30 is built on, checked rather than asserted: once the shape
    // key is open, the model chooses between the kinds and nothing else.
    const next = allowedNext('{"kind":"');
    expect(next.sort()).toEqual(['a', 'c', 'd', 'm', 'n', 's', 't']);
  });

  it("n'accepte que { comme tout premier caractère", () => {
    expect(allowedNext('')).toEqual(['{']);
  });
});

describe('grammaire — accord avec le validateur', () => {
  /**
   * One complete string per alternative, built by walking its atoms and taking
   * the option at `pick` (clamped). Exhaustive over the alternatives, and
   * linear — a depth-first search over characters was exact too, but it took
   * five seconds and timed out under load, which makes it a worse test than a
   * slightly narrower one that always runs.
   */
  function sample(pick: number): string[] {
    const decoder = new TextDecoder();
    return grammar.alternatives.map((atoms) => {
      // The option index advances at every choice, so `correlation` gets two
      // DIFFERENT columns rather than the same one twice.
      let choice = pick;
      return atoms
        .map((atom) => {
          if (atom.kind === 'lit') return decoder.decode(atom.bytes);
          if (atom.kind === 'oneOf') {
            const at = choice++ % atom.options.length;
            return decoder.decode(atom.options[at]);
          }
          return atom.kind === 'number' ? '-12.5' : '"libre"';
        })
        .join('');
    });
  }

  it('écrit une requête complète pour chaque alternative', () => {
    for (const pick of [0, 1, 99]) {
      for (const text of sample(pick)) {
        expect(isComplete(grammar, text), text).toBe(true);
      }
    }
  });

  it('accepte une corrélation dégénérée que le validateur refuse', () => {
    // The one over-approximation the module's header declares: writing `a` and
    // `b` as the SAME column would need one alternative per pair, and the
    // validator already refuses it. Pinned here so the gap stays a decision
    // rather than a surprise.
    expect(isComplete(grammar, '{"kind":"correlation","a":"age","b":"age"}')).toBe(true);
    expect(validateIntent({ kind: 'correlation', a: 'age', b: 'age' }, BENCH_COLUMNS)).toBeNull();
  });

  it('toute requête complète passe validateIntent', () => {
    // The automaton is a filter, not the validator. This proves the two agree
    // on everything the automaton can write, apart from the one gap above.
    for (const pick of [0, 1, 99]) {
      for (const text of sample(pick)) {
        const parsed: unknown = JSON.parse(text);
        if ((parsed as { kind: string }).kind === 'none') continue; // not an Intent
        expect(validateIntent(parsed, BENCH_COLUMNS), text).not.toBeNull();
      }
    }
  });
});

describe('grammaire — tables réelles', () => {
  it("plafonne les colonnes filtrables et n'explose pas", () => {
    const wide: ColumnInfo[] = Array.from({ length: MAX_FILTER_COLUMNS + 20 }, (_, i) => ({
      name: `c${i}`,
      isNumeric: true,
      values: [],
    }));
    const big = buildGrammar(wide);
    // Past the cap a column is still aggregable and groupable...
    expect(isComplete(big, '{"kind":"aggregate","op":"mean","column":"c80"}')).toBe(true);
    // ...but no longer filterable, which is the announced trade.
    expect(isComplete(big, '{"kind":"count","filter":{"column":"c80","op":">","value":1}}')).toBe(
      false,
    );
    expect(isComplete(big, '{"kind":"count","filter":{"column":"c1","op":">","value":1}}')).toBe(
      true,
    );
  });

  it('accepte une valeur accentuée, octet par octet', () => {
    // The reason the automaton walks bytes: « Côte d'Ivoire » is not a
    // sequence of whole-character tokens in Qwen's byte-level vocabulary, and
    // a character-level automaton would have made it unwritable.
    const accented = buildGrammar([
      { name: 'région', isNumeric: false, values: ["Côte d'Ivoire", 'Île-de-France'] },
      { name: 'n', isNumeric: true, values: [] },
    ]);
    expect(
      isComplete(
        accented,
        '{"kind":"count","filter":{"column":"région","op":"=","value":"Île-de-France"}}',
      ),
    ).toBe(true);
    expect(
      isComplete(
        accented,
        '{"kind":"count","filter":{"column":"région","op":"=","value":"Ile-de-France"}}',
      ),
    ).toBe(false);
  });

  it('accepte une valeur libre sur une colonne de texte sans valeurs connues', () => {
    const free = buildGrammar([
      { name: 'city', isNumeric: false, values: [] },
      { name: 'n', isNumeric: true, values: [] },
    ]);
    expect(
      isComplete(free, '{"kind":"count","filter":{"column":"city","op":"=","value":"Paris"}}'),
    ).toBe(true);
  });
});

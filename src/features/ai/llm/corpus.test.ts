/**
 * V30 — the half of the bench that runs in CI.
 *
 * The model needs 355 MB and a GPU (or several minutes of CPU), so its half
 * lives in `bench.node.test.ts` and runs on demand. Everything else about the
 * corpus is checkable here, in two seconds, on every commit: that the corpus
 * is well-formed, and exactly how the deterministic parser reads it.
 *
 * The second one is the regression guard V30 exists to install. Before this
 * wave the parser answered seven of these fifty-five questions with a
 * condition silently removed — « combien de femmes ? » answered 891 instead of
 * 314, under the badge that says the reading is exact. The `wrong` count below
 * is asserted to be ZERO, and that assertion is the whole point: it fails the
 * build the day the grammar starts answering a question nobody asked.
 */
import { describe, it, expect } from 'vitest';
import { BENCH_CASES, BENCH_COLUMNS, score, sameIntent } from '@/features/ai/llm/corpus';
import { validateIntent } from '@/features/ai/llm/prompt';
import { isComplete, buildGrammar } from '@/features/ai/llm/grammar';
import { parseQuestion } from '@/features/ai/chat/parser';
import type { Outcome } from '@/features/ai/llm/corpus';

function deterministicTally(): Record<Outcome, number> {
  const counts: Record<Outcome, number> = { ok: 0, wrong: 0, none: 0 };
  for (const testCase of BENCH_CASES) {
    counts[score(testCase, parseQuestion(testCase.q, BENCH_COLUMNS, testCase.lang))] += 1;
  }
  return counts;
}

describe('corpus V30 — le corpus lui-même', () => {
  it('compte entre 40 et 60 questions, dans les deux langues', () => {
    expect(BENCH_CASES.length).toBeGreaterThanOrEqual(40);
    expect(BENCH_CASES.length).toBeLessThanOrEqual(60);
    expect(BENCH_CASES.filter((c) => c.lang === 'fr').length).toBeGreaterThanOrEqual(20);
    expect(BENCH_CASES.filter((c) => c.lang === 'en').length).toBeGreaterThanOrEqual(20);
  });

  it('ne pose jamais deux fois la même question', () => {
    const seen = new Set(BENCH_CASES.map((c) => c.q));
    expect(seen.size).toBe(BENCH_CASES.length);
  });

  it('couvre les sept formes de la grammaire, plus le refus', () => {
    const families = new Set(BENCH_CASES.map((c) => c.family));
    for (const family of [
      'shape',
      'missing',
      'count',
      'aggregate',
      'distribution',
      'correlation',
      'topk',
      'refuse',
    ]) {
      expect(families.has(family as never), family).toBe(true);
    }
  });

  it('attend des réponses que le validateur et la grammaire acceptent', () => {
    // A corpus whose expected answers are themselves out of grammar would
    // measure the measuring instrument, not the app.
    const grammar = buildGrammar(BENCH_COLUMNS);
    for (const testCase of BENCH_CASES) {
      for (const intent of [testCase.want, ...(testCase.alsoOk ?? [])]) {
        if (intent === null) continue;
        expect(validateIntent(intent, BENCH_COLUMNS), testCase.q).not.toBeNull();
        expect(isComplete(grammar, JSON.stringify(intent)), `${testCase.q} → grammaire`).toBe(true);
      }
    }
  });

  it('ne compte juste que la lecture attendue', () => {
    const shape = BENCH_CASES.find((c) => c.family === 'shape')!;
    expect(score(shape, { kind: 'shape' })).toBe('ok');
    expect(score(shape, { kind: 'missing' })).toBe('wrong');
    expect(score(shape, null)).toBe('none');
    const refuse = BENCH_CASES.find((c) => c.family === 'refuse')!;
    expect(score(refuse, null)).toBe('ok');
    expect(score(refuse, { kind: 'shape' })).toBe('wrong');
  });

  it("compare les intentions sans tenir compte de l'ordre des clés", () => {
    expect(
      sameIntent({ kind: 'aggregate', op: 'mean', column: 'age' }, {
        column: 'age',
        op: 'mean',
        kind: 'aggregate',
      } as never),
    ).toBe(true);
    expect(sameIntent(null, null)).toBe(true);
    expect(sameIntent(null, { kind: 'shape' })).toBe(false);
  });
});

describe('corpus V30 — lecture déterministe', () => {
  it('ne répond JAMAIS à côté : zéro réponse fausse', () => {
    // The V30 invariant. A wrong deterministic answer cannot be rescued — the
    // parser runs first and the model is never consulted — so it is the only
    // outcome the grammar is forbidden to produce.
    expect(deterministicTally().wrong).toBe(0);
  });

  it('lit 19 questions sur 55 et refuse les 36 autres', () => {
    // Measured, not aimed at: the exact split the wave shipped with. A change
    // that moves either number is a change in what the chat understands, and
    // should be an explicit decision rather than a surprise.
    expect(deterministicTally()).toEqual({ ok: 19, wrong: 0, none: 36 });
  });

  it("refuse plutôt que de laisser tomber une condition qu'il ne lit pas", () => {
    // The four questions that used to be answered short, by name.
    for (const q of [
      'combien de femmes ?',
      'average age of women',
      'combien de passagers en première classe ?',
      'quel âge avaient les passagers en moyenne, par classe ?',
    ]) {
      const testCase = BENCH_CASES.find((c) => c.q === q)!;
      expect(parseQuestion(q, BENCH_COLUMNS, testCase.lang), q).toBeNull();
    }
  });
});

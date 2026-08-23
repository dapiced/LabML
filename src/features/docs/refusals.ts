/**
 * V33 — the catalogue of named refusals.
 *
 * Refusing well is this project's distinguishing feature, and a refusal nobody
 * can decode reads as a bug rather than as the decision it is. So every code
 * the shipped app throws is listed here once, with who is meant to see it.
 *
 * **This list is not written from memory.** It was extracted from the source,
 * and `refusals.test.ts` re-extracts it on every run: a code thrown but not
 * listed fails, and a code listed but no longer thrown fails too. Documentation
 * that cannot be checked eventually lies, which is the lesson V32 paid for.
 *
 * `audience` is the useful split for a reader:
 *  - `visitor` — surfaced in the interface, with its own message. These are the
 *    rows of the public table: something to understand and act on.
 *  - `internal` — an invariant of the code. A visitor should never meet one;
 *    if they do, that is a bug report, not a decision the app made.
 */
export type RefusalAudience = 'visitor' | 'internal';

export type RefusalArea = 'ml' | 'import' | 'data' | 'chat' | 'llm' | 'vision';

export interface Refusal {
  /** The exact string thrown, before any `:detail` suffix. */
  code: string;
  audience: RefusalAudience;
  area: RefusalArea;
}

/**
 * Every code `throw new Error('…')` raises in the shipped app.
 *
 * Test-only codes are deliberately absent: `constrained-decoding-unavailable`
 * belongs to the LLM bench and `header-not-served` to the privacy policy test.
 * Neither can reach a visitor, and listing them would pad the public table with
 * rows nobody can encounter.
 */
export const REFUSALS: Refusal[] = [
  // --- ML Lab: training refuses rather than training something meaningless ---
  { code: 'no-features', audience: 'visitor', area: 'ml' },
  { code: 'target-not-found', audience: 'visitor', area: 'ml' },
  { code: 'task-undetectable', audience: 'visitor', area: 'ml' },
  { code: 'split-column-not-found', audience: 'visitor', area: 'ml' },
  { code: 'split-column-not-dated', audience: 'visitor', area: 'ml' },
  { code: 'split-column-not-groupable', audience: 'visitor', area: 'ml' },
  { code: 'too-few-rows', audience: 'visitor', area: 'ml' },
  { code: 'too-few-points', audience: 'visitor', area: 'ml' },
  { code: 'missing-columns', audience: 'visitor', area: 'ml' },
  { code: 'model-not-found', audience: 'internal', area: 'ml' },
  { code: 'no-references', audience: 'internal', area: 'ml' },
  { code: 'no-model', audience: 'internal', area: 'ml' },
  { code: 'no-run', audience: 'internal', area: 'ml' },

  // --- Importing a model: five named reasons instead of one « invalid file » ---
  { code: 'invalid-json', audience: 'visitor', area: 'import' },
  { code: 'not-labml', audience: 'visitor', area: 'import' },
  { code: 'unsupported-version', audience: 'visitor', area: 'import' },
  { code: 'bad-manifest', audience: 'visitor', area: 'import' },
  { code: 'unsupported-kind', audience: 'visitor', area: 'import' },

  // --- Data Studio ---
  { code: 'join-key-missing', audience: 'visitor', area: 'data' },
  { code: 'no-join', audience: 'internal', area: 'data' },
  { code: 'duckdb-no-worker', audience: 'visitor', area: 'data' },
  { code: 'sql-unsupported-file', audience: 'visitor', area: 'data' },

  // --- Data assistant ---
  { code: 'filter-not-numeric', audience: 'visitor', area: 'chat' },
  { code: 'unknown-column', audience: 'visitor', area: 'chat' },
  { code: 'no-data', audience: 'internal', area: 'chat' },

  // --- Local language model: the four ways a sharded download can be wrong ---
  { code: 'llm-part-missing', audience: 'visitor', area: 'llm' },
  { code: 'llm-part-size', audience: 'visitor', area: 'llm' },
  { code: 'llm-short', audience: 'visitor', area: 'llm' },
  { code: 'llm-overflow', audience: 'visitor', area: 'llm' },
  { code: 'no-webgpu', audience: 'visitor', area: 'llm' },
  { code: 'no-manifest', audience: 'internal', area: 'llm' },

  // --- Vision ---
  { code: 'not-ready', audience: 'internal', area: 'vision' },
  { code: 'canvas-2d', audience: 'internal', area: 'vision' },

  // --- Grammar automaton: invariants asserted while the mask is built ---
  { code: 'grammar-too-long', audience: 'internal', area: 'llm' },
  { code: 'grammar-atom-long', audience: 'internal', area: 'llm' },
  { code: 'grammar-option-long', audience: 'internal', area: 'llm' },
  { code: 'grammar-too-many-options', audience: 'internal', area: 'llm' },
];

/** The rows of the public table — what a visitor can meet and act on. */
export function visitorRefusals(list: readonly Refusal[] = REFUSALS): Refusal[] {
  return list.filter((refusal) => refusal.audience === 'visitor');
}

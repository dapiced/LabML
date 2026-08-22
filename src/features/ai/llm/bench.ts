/**
 * V27 — the interpretation bench, run against the REAL production path:
 * the sharded model under /llm/, glued by the same custom cache the app uses,
 * on the same WebGPU runtime. It measures the only thing that justifies a
 * 355 MB download — how often the local model turns a question into a query
 * the deterministic parser could not.
 *
 * It ships as a repo tool rather than a CI test because it needs a GPU with
 * `shader-f16`, which CI runners do not have. See docs in PLAN.md § N (V27).
 *
 *   npm run llm:prepare -- public/llm
 *   V27_BENCH=1 npm run build && npm run preview
 *   node scripts/run-llm-bench.mjs
 */
import { parseQuestion, type ColumnInfo } from '@/features/ai/chat/parser';
import { loadModel, probeCapability } from '@/features/ai/llm/interpret';
import type { Intent } from '@/features/ai/chat/engine';

/** Titanic's columns, as the chat worker would summarize them. */
export const BENCH_COLUMNS: ColumnInfo[] = [
  { name: 'survived', isNumeric: true, values: [] },
  { name: 'pclass', isNumeric: true, values: [] },
  { name: 'sex', isNumeric: false, values: ['male', 'female'] },
  { name: 'age', isNumeric: true, values: [] },
  { name: 'fare', isNumeric: true, values: [] },
  { name: 'embarked', isNumeric: false, values: ['S', 'C', 'Q'] },
  { name: 'class', isNumeric: false, values: ['Third', 'First', 'Second'] },
  { name: 'who', isNumeric: false, values: ['man', 'woman', 'child'] },
  { name: 'deck', isNumeric: false, values: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] },
  { name: 'embark_town', isNumeric: false, values: ['Southampton', 'Cherbourg', 'Queenstown'] },
  { name: 'alive', isNumeric: false, values: ['no', 'yes'] },
  { name: 'alone', isNumeric: false, values: ['True', 'False'] },
];

export interface BenchCase {
  q: string;
  lang: string;
  want: Intent;
  /** True for phrasings the keyword grammar was never going to catch. */
  beyondKeywords: boolean;
}

export const BENCH_CASES: BenchCase[] = [
  { q: 'how many rows and columns?', lang: 'en', want: { kind: 'shape' }, beyondKeywords: false },
  {
    q: 'combien de lignes et de colonnes ?',
    lang: 'fr',
    want: { kind: 'shape' },
    beyondKeywords: false,
  },
  {
    q: 'average age',
    lang: 'en',
    want: { kind: 'aggregate', op: 'mean', column: 'age' },
    beyondKeywords: false,
  },
  {
    q: 'moyenne de fare par class',
    lang: 'fr',
    want: { kind: 'aggregate', op: 'mean', column: 'fare', groupBy: 'class' },
    beyondKeywords: false,
  },
  {
    q: 'distribution of class',
    lang: 'en',
    want: { kind: 'distribution', column: 'class' },
    beyondKeywords: false,
  },
  {
    q: 'correlation between age and fare',
    lang: 'en',
    want: { kind: 'correlation', a: 'age', b: 'fare' },
    beyondKeywords: false,
  },
  { q: 'valeurs manquantes', lang: 'fr', want: { kind: 'missing' }, beyondKeywords: false },
  {
    q: 'how many female?',
    lang: 'en',
    want: { kind: 'count', filter: { column: 'sex', op: '=', value: 'female' } },
    beyondKeywords: false,
  },
  // --- The gap the model has to justify --------------------------------
  {
    q: 'what was the typical age of the people on board?',
    lang: 'en',
    want: { kind: 'aggregate', op: 'mean', column: 'age' },
    beyondKeywords: true,
  },
  {
    q: 'a quel age moyen voyageaient les passagers ?',
    lang: 'fr',
    want: { kind: 'aggregate', op: 'mean', column: 'age' },
    beyondKeywords: true,
  },
  {
    q: 'did women pay more than men?',
    lang: 'en',
    want: { kind: 'aggregate', op: 'mean', column: 'fare', groupBy: 'sex' },
    beyondKeywords: true,
  },
  {
    q: 'est-ce que le prix du billet dependait de la classe ?',
    lang: 'fr',
    want: { kind: 'aggregate', op: 'mean', column: 'fare', groupBy: 'class' },
    beyondKeywords: true,
  },
  {
    q: 'show me how the ticket prices spread out',
    lang: 'en',
    want: { kind: 'distribution', column: 'fare' },
    beyondKeywords: true,
  },
  {
    q: 'combien de personnes sont montees a Cherbourg ?',
    lang: 'fr',
    want: { kind: 'count', filter: { column: 'embark_town', op: '=', value: 'Cherbourg' } },
    beyondKeywords: true,
  },
  {
    q: 'count the passengers older than 60',
    lang: 'en',
    want: { kind: 'count', filter: { column: 'age', op: '>', value: 60 } },
    beyondKeywords: true,
  },
  {
    q: 'y a-t-il un lien entre le prix paye et la survie ?',
    lang: 'fr',
    want: { kind: 'correlation', a: 'fare', b: 'survived' },
    beyondKeywords: true,
  },
  // V27.1: the two shapes the measured failures exposed — an implicit numeric
  // threshold ("enfants" is not a column, `age < 10` is), and a top-k, which
  // the model had never seen an example of.
  {
    q: "combien d'enfants de moins de 10 ans ?",
    lang: 'fr',
    want: { kind: 'count', filter: { column: 'age', op: '<', value: 10 } },
    beyondKeywords: true,
  },
  {
    q: 'les 3 ponts avec le plus de passagers',
    lang: 'fr',
    want: { kind: 'topk', groupBy: 'deck', k: 3, op: 'count' },
    beyondKeywords: true,
  },
];

/** Key-order-independent equality — the grammar has no meaningful ordering. */
export function sameIntent(a: Intent | null, b: Intent): boolean {
  if (!a) return false;
  const norm = (i: Intent) => JSON.stringify(i, Object.keys(i).sort());
  return norm(a) === norm(b);
}

export type Outcome = 'ok' | 'wrong' | 'none';

export interface BenchRow {
  q: string;
  lang: string;
  beyondKeywords: boolean;
  deterministic: Outcome;
  llm: Outcome;
  /**
   * V27.1 — what the app actually answers, in the shipped order: the keyword
   * grammar's reading when it has one, the model's only otherwise. This is the
   * number that describes the product; the two columns above describe the
   * parts.
   */
  pipeline: Outcome;
  raw: string;
  ms: number;
}

export interface BenchReport {
  total: number;
  loadMs: number;
  rows: BenchRow[];
}

export async function runBench(log: (line: string) => void): Promise<BenchReport> {
  const capability = await probeCapability();
  if (!capability) throw new Error('no-manifest: run `npm run llm:prepare -- public/llm` first');
  if (!capability.webgpu) throw new Error('no-webgpu: this bench needs a GPU with shader-f16');

  const started = Date.now();
  const model = await loadModel(capability.manifest, {
    onProgress: ({ loaded, total }) =>
      log(`téléchargement ${Math.round((loaded / total) * 100)} %`),
  });
  const loadMs = Date.now() - started;
  log(`modèle chargé en ${loadMs} ms`);

  const rows: BenchRow[] = [];
  for (const testCase of BENCH_CASES) {
    const det = parseQuestion(testCase.q, BENCH_COLUMNS, testCase.lang);
    const result = await model.generate(testCase.q, BENCH_COLUMNS);
    const outcome = (intent: Intent | null): Outcome =>
      !intent ? 'none' : sameIntent(intent, testCase.want) ? 'ok' : 'wrong';
    rows.push({
      q: testCase.q,
      lang: testCase.lang,
      beyondKeywords: testCase.beyondKeywords,
      deterministic: outcome(det),
      llm: outcome(result.intent),
      pipeline: det ? outcome(det) : outcome(result.intent),
      raw: result.raw.slice(0, 200),
      ms: Math.round(result.ms),
    });
    const last = rows[rows.length - 1];
    log(
      `${rows.length}/${BENCH_CASES.length} ${testCase.q.slice(0, 44)} → det=${last.deterministic} lm=${last.llm} app=${last.pipeline} (${last.ms} ms)`,
    );
  }
  await model.dispose();
  return { total: BENCH_CASES.length, loadMs, rows };
}

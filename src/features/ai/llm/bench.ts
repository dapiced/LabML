/**
 * V30 — the browser half of the bench: the same corpus, run against the REAL
 * production path. The sharded model under /llm/, glued by the same custom
 * cache the app uses, on the same WebGPU runtime.
 *
 * Its companion `bench.node.test.ts` runs the identical corpus on the CPU and
 * needs no GPU at all. Neither replaces the other: the Node bench is the one
 * that can run anywhere and therefore the one that keeps the numbers honest
 * between releases; this one is the only one that measures what a visitor's
 * browser actually does, latency included.
 *
 *   npm run llm:prepare -- public/llm
 *   V27_BENCH=1 npm run build && npm run preview
 *   node scripts/run-llm-bench.mjs
 */
import { BENCH_CASES, BENCH_COLUMNS, score } from '@/features/ai/llm/corpus';
import { formatReport, type BenchReport, type BenchRow } from '@/features/ai/llm/report';
import { loadModel, probeCapability } from '@/features/ai/llm/interpret';
import { parseQuestion } from '@/features/ai/chat/parser';
import { resolveIntent } from '@/features/ai/chat/route';

export type { BenchReport, BenchRow };
export { BENCH_CASES, BENCH_COLUMNS, formatReport };

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
    const deterministic = parseQuestion(testCase.q, BENCH_COLUMNS, testCase.lang);
    const result = await model.generate(testCase.q, BENCH_COLUMNS);
    // The shipped order, decided by the function the chat worker itself calls.
    const shipped = await resolveIntent(
      () => parseQuestion(testCase.q, BENCH_COLUMNS, testCase.lang),
      async () => result.intent,
    );
    rows.push({
      q: testCase.q,
      lang: testCase.lang,
      family: testCase.family,
      deterministic: score(testCase, deterministic),
      llm: score(testCase, result.intent),
      pipeline: score(testCase, shipped.intent),
      raw: result.raw.slice(0, 240),
      ms: Math.round(result.ms),
    });
    const last = rows[rows.length - 1];
    log(
      `${rows.length}/${BENCH_CASES.length} ${testCase.q.slice(0, 44)} → det=${last.deterministic} lm=${last.llm} app=${last.pipeline} (${last.ms} ms)`,
    );
  }
  await model.dispose();
  return { label: 'banc V30 (navigateur, WebGPU)', total: BENCH_CASES.length, loadMs, rows };
}

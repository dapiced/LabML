// @vitest-environment node
/**
 * V30 — the bench that runs without a GPU.
 *
 * V27's bench needed WebGPU with `shader-f16`, so it could only ever run on
 * one person's laptop. That is why « 5 of 6 » stayed a claim rather than a
 * measurement: nobody else could re-run it, and no automated check ever would.
 *
 * onnxruntime-node executes the SAME q4f16 graph on the CPU, from the SAME
 * pinned files `scripts/prepare-llm.mjs --flat` downloads for production. So
 * this file measures the shipped model with the shipped prompt through the
 * shipped decoding path — the only difference from a browser is which device
 * runs the matrix multiplies. Greedy decoding makes the comparison meaningful:
 * with `do_sample: false` there is no sampling noise between the two, though
 * the two backends can still differ on a near-tie between two tokens.
 *
 * It is skipped unless LABML_LLM_BENCH=1, because it needs 355 MB on disk that
 * the repo deliberately does not carry:
 *
 *   node scripts/prepare-llm.mjs .llm-cache --flat
 *   npm run llm:bench:node
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { BENCH_CASES, BENCH_COLUMNS, score } from '@/features/ai/llm/corpus';
import {
  createConstrainer,
  generateIntent,
  type Constrainer,
  type LogitsModule,
  type RawGenerator,
} from '@/features/ai/llm/generate';
import { formatReport, type BenchReport, type BenchRow } from '@/features/ai/llm/report';
import { resolveIntent } from '@/features/ai/chat/route';
import { parseQuestion } from '@/features/ai/chat/parser';

const ENABLED = process.env.LABML_LLM_BENCH === '1';
const MODELS = process.env.LABML_LLM_CACHE ?? resolve(process.cwd(), '.llm-cache');
/**
 * The model under test. It defaults to the one production ships, and is
 * overridable so that « would a bigger model read better? » is a one-command
 * experiment on the same 55 questions rather than an opinion:
 *
 *   LABML_LLM_REPO=onnx-community/Qwen3-1.7B-ONNX npm run llm:bench:node
 *
 * The weights have to be under LABML_LLM_CACHE already — `npm run llm:fetch`
 * only knows the pinned files of the shipped model, by design: a size check
 * that accepts anything is not a size check.
 */
const REPO = process.env.LABML_LLM_REPO ?? 'onnx-community/Qwen3-0.6B-DQ-ONNX';
const DTYPE = process.env.LABML_LLM_DTYPE ?? 'q4f16';
const LABEL = process.env.LABML_LLM_LABEL ?? 'banc V30 (CPU, onnxruntime-node)';
const OUT = process.env.LABML_LLM_OUT;
/** V30 (B): decode inside the grammar. Off reproduces the V27 behaviour exactly. */
const CONSTRAINED = process.env.LABML_LLM_CONSTRAIN === '1';
/** A short run while iterating; a full run is the only one worth publishing. */
const LIMIT = Number(process.env.LABML_LLM_LIMIT ?? BENCH_CASES.length);
/** Loading 355 MB and answering 55 questions on a CPU is minutes, not seconds. */
const TIMEOUT_MS = 90 * 60 * 1000;

async function loadCpuModel(): Promise<{
  generator: RawGenerator;
  loadMs: number;
  constrain: Constrainer | null;
}> {
  const module = await import('@huggingface/transformers');
  const { env, pipeline } = module;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = MODELS.endsWith('/') ? MODELS : `${MODELS}/`;
  const started = Date.now();
  const generator = await pipeline('text-generation', REPO, {
    dtype: DTYPE as 'q4f16',
    device: 'cpu',
  });
  const loadMs = Date.now() - started;
  const constrain = CONSTRAINED
    ? createConstrainer(module as unknown as LogitsModule, generator.tokenizer)
    : null;
  if (CONSTRAINED && !constrain) throw new Error('constrained-decoding-unavailable');
  return { generator: generator as unknown as RawGenerator, loadMs, constrain };
}

describe.skipIf(!ENABLED)("banc d'interprétation V30", () => {
  it(
    'mesure le corpus complet contre le modèle réel',
    async () => {
      const weights = `${MODELS}/${REPO}/onnx/model_${DTYPE}.onnx`;
      expect(
        existsSync(weights),
        `poids absents : ${weights}\nlancer d'abord : node scripts/prepare-llm.mjs .llm-cache --flat`,
      ).toBe(true);

      const { generator, loadMs, constrain } = await loadCpuModel();
      if (constrain)
        console.log(`décodage contraint actif — ${constrain.usableTokens} jetons utilisables`);
      const rows: BenchRow[] = [];
      const cases = BENCH_CASES.slice(0, LIMIT);
      for (const testCase of cases) {
        const deterministic = parseQuestion(testCase.q, BENCH_COLUMNS, testCase.lang);
        const result = await generateIntent(generator, testCase.q, BENCH_COLUMNS, { constrain });
        // The shipped order, not a re-implementation of it: the same function
        // the chat worker calls decides who answers.
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
        console.log(
          `${String(rows.length).padStart(2)}/${cases.length} ${testCase.q.slice(0, 46).padEnd(46)} ` +
            `det=${last.deterministic.padEnd(5)} lm=${last.llm.padEnd(5)} app=${last.pipeline.padEnd(5)} (${last.ms} ms)`,
        );
      }
      await generator.dispose?.();

      const report: BenchReport = {
        label:
          `${LABEL} · ${REPO} ${DTYPE}` +
          `${CONSTRAINED ? ' — décodage contraint' : ' — décodage libre'}`,
        total: cases.length,
        loadMs,
        rows,
      };
      console.log(formatReport(report));
      if (OUT) {
        await mkdir(dirname(OUT), { recursive: true });
        await writeFile(OUT, JSON.stringify(report, null, 2));
        console.log(`\nrapport écrit dans ${OUT}`);
      }
      expect(rows).toHaveLength(cases.length);
    },
    TIMEOUT_MS,
  );
});

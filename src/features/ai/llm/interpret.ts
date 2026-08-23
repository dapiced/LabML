/**
 * V27 — the local language model, loaded on demand and used for ONE thing:
 * turning a free-form question into a query the V6 deterministic engine can
 * execute. It never computes an answer and never sees a data row.
 *
 * Three refusals are named rather than hidden: no WebGPU (the model would be
 * unusably slow on single-threaded WASM), a download the user did not accept,
 * and an answer that fails the grammar check. Each one falls back to the
 * deterministic parser, which stays the default engine.
 */
import {
  createConstrainer,
  generateIntent,
  type Constrainer,
  type InterpretResult,
  type LogitsModule,
  type RawGenerator,
} from '@/features/ai/llm/generate';
import {
  createShardCache,
  type DownloadProgress,
  type LlmManifest,
} from '@/features/ai/llm/shards';
import type { ColumnInfo } from '@/features/ai/chat/parser';

/** Where the build script (scripts/prepare-llm.mjs) puts the sharded model. */
export const LLM_BASE = '/llm/';

export type { InterpretResult };

export interface LlmCapability {
  /** Measured, never assumed: WebGPU decides whether this is usable at all. */
  webgpu: boolean;
  /** Total bytes to download, straight from the manifest — shown before consent. */
  totalBytes: number;
  manifest: LlmManifest;
}

/**
 * WebGPU is required. On single-threaded WASM (we ship no COOP/COEP headers,
 * so threads are off) a 0.6B model answers in minutes, not seconds — offering
 * it would be a worse lie than refusing it.
 */
export async function detectWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

export async function probeCapability(baseUrl = LLM_BASE): Promise<LlmCapability | null> {
  try {
    const response = await fetch(`${baseUrl}manifest.json`);
    if (!response.ok) return null;
    const manifest = (await response.json()) as LlmManifest;
    if (!Array.isArray(manifest.files) || typeof manifest.totalBytes !== 'number') return null;
    return { webgpu: await detectWebGpu(), totalBytes: manifest.totalBytes, manifest };
  } catch {
    // No manifest deployed (local dev without the model) — the deterministic
    // engine simply stays the only one offered. Not an error.
    return null;
  }
}

export interface LoadedModel {
  generate(question: string, columns: ColumnInfo[]): Promise<InterpretResult>;
  /**
   * V30 — whether the answer is being decoded inside the query grammar. False
   * means the tokenizer did not expose its vocabulary, and the UI says so:
   * the model still answers, its answers are still validated, but the guard
   * that makes a malformed one impossible is not running.
   */
  constrained: boolean;
  dispose(): Promise<void>;
}

export async function loadModel(
  manifest: LlmManifest,
  options: {
    baseUrl?: string;
    onProgress?: (progress: DownloadProgress) => void;
    signal?: AbortSignal;
    /** V30 — off only to reproduce the pre-V30 behaviour on the bench. */
    constrained?: boolean;
  } = {},
): Promise<LoadedModel> {
  const baseUrl = options.baseUrl ?? LLM_BASE;
  const library = await import('@huggingface/transformers');
  const { env, pipeline } = library;
  // Everything self-hosted: the strict CSP forbids the library's CDN default.
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = baseUrl;
  env.backends.onnx.wasm!.wasmPaths = '/ort-llm/';
  // Sharded weights are glued back together here — see shards.ts.
  env.useCustomCache = true;
  env.customCache = createShardCache(
    manifest,
    `${baseUrl}${manifest.repo}/`,
    options.onProgress,
    options.signal,
  );

  const generator = await pipeline('text-generation', manifest.repo, {
    dtype: 'q4f16',
    device: 'webgpu',
  });

  const constrain: Constrainer | null =
    options.constrained === false
      ? null
      : createConstrainer(library as unknown as LogitsModule, generator.tokenizer);

  return {
    constrained: constrain !== null,
    generate: (question, columns) =>
      generateIntent(generator as unknown as RawGenerator, question, columns, { constrain }),
    async dispose() {
      await generator.dispose?.();
    },
  };
}

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
import { buildSystemPrompt, buildUserPrompt, intentFromCompletion } from '@/features/ai/llm/prompt';
import {
  createShardCache,
  type DownloadProgress,
  type LlmManifest,
} from '@/features/ai/llm/shards';
import type { Intent } from '@/features/ai/chat/engine';
import type { ColumnInfo } from '@/features/ai/chat/parser';

/** Where the build script (scripts/prepare-llm.mjs) puts the sharded model. */
export const LLM_BASE = '/llm/';
/** Enough for the longest valid query; the JSON we want is far shorter. */
const MAX_NEW_TOKENS = 96;

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
  dispose(): Promise<void>;
}

export interface InterpretResult {
  /** Null when the model's answer failed the grammar check — a refusal. */
  intent: Intent | null;
  /** What the model actually produced, kept for the honest "why" panel. */
  raw: string;
  ms: number;
}

export async function loadModel(
  manifest: LlmManifest,
  options: {
    baseUrl?: string;
    onProgress?: (progress: DownloadProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<LoadedModel> {
  const baseUrl = options.baseUrl ?? LLM_BASE;
  const { env, pipeline } = await import('@huggingface/transformers');
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

  return {
    async generate(question, columns) {
      const started = performance.now();
      // Qwen3 is a reasoning model: left to itself it opens a <think> block and
      // spends the whole token budget arguing with itself before answering.
      // The chat template turns that off when `enable_thinking` is explicitly
      // false — so we apply the template ourselves instead of handing the
      // pipeline a message list and hoping. Without this the model NEVER emits
      // the JSON and every question silently falls back to the parser.
      const prompt = generator.tokenizer.apply_chat_template(
        [
          { role: 'system', content: buildSystemPrompt(columns) },
          { role: 'user', content: buildUserPrompt(question) },
        ],
        // `enable_thinking` is not in the library's option type, but every
        // unknown key is spread into the Jinja template — which is exactly
        // where Qwen3 reads it.
        {
          tokenize: false,
          add_generation_prompt: true,
          enable_thinking: false,
        } as unknown as { tokenize: false; add_generation_prompt: boolean },
      ) as string;
      const output = (await generator(prompt, {
        // Greedy: the same question must give the same query, every time.
        max_new_tokens: MAX_NEW_TOKENS,
        do_sample: false,
        return_full_text: false,
      })) as { generated_text: string }[];
      const raw = output[0]?.generated_text ?? '';
      return { intent: intentFromCompletion(raw, columns), raw, ms: performance.now() - started };
    },
    async dispose() {
      await generator.dispose?.();
    },
  };
}

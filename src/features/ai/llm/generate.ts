/**
 * V30 — the generation core, shared by the browser and by the bench.
 *
 * V27 built the prompt, called the pipeline and decoded the answer inside
 * `loadModel`, which only runs on WebGPU. The bench therefore had to rebuild
 * the same three steps for itself, and any drift between the two copies would
 * have made every measured number describe something the product does not do.
 * The steps live here now, exactly once: the browser and the bench differ only
 * in how the weights are loaded, never in what is asked of them or how the
 * answer is read.
 */
import { buildSystemPrompt, buildUserPrompt, intentFromCompletion } from '@/features/ai/llm/prompt';
import { buildGrammar } from '@/features/ai/llm/grammar';
import {
  buildVocabIndex,
  createGrammarProcessor,
  readVocab,
  type LogitsProcessorLike,
  type VocabIndex,
} from '@/features/ai/llm/constrain';
import type { Intent } from '@/features/ai/chat/engine';
import type { ColumnInfo } from '@/features/ai/chat/parser';

/** Enough for the longest valid query; the JSON we want is far shorter. */
export const MAX_NEW_TOKENS = 96;

/**
 * Whether the answer is decoded inside the query grammar. TRUE is what the
 * browser does, so it is what the bench must do by default.
 *
 * It lives here, in one place, because of a defect this constant exists to
 * make impossible: V30's first CI bench measured **free** decoding — the flag
 * was opt-in and the workflow did not set it — so the number it published
 * described a configuration nobody ships. A bench that measures something
 * other than the product is worse than no bench: it is a wrong number with a
 * green tick beside it. Turning the constraint OFF is now the thing that takes
 * an explicit flag, and the only reason to do it is to reproduce the pre-V30
 * behaviour for comparison.
 */
export const DECODE_CONSTRAINED_BY_DEFAULT = true;

/**
 * The shape of a transformers.js text-generation pipeline, described
 * structurally so this module never imports the library — it is loaded on
 * demand in the browser and must not be pulled into the main bundle.
 */
export interface RawGenerator {
  (input: string, options: Record<string, unknown>): Promise<{ generated_text: string }[]>;
  tokenizer: {
    apply_chat_template(messages: unknown, options: Record<string, unknown>): string | unknown;
  };
  dispose?: () => Promise<void>;
}

/**
 * V30 — constrained decoding, built once per loaded model.
 *
 * The library's `LogitsProcessor` classes are passed in rather than imported:
 * `@huggingface/transformers` is 355 MB of model away from being wanted, and
 * this module must never pull it into the main bundle.
 */
export interface Constrainer {
  processorList(columns: ColumnInfo[]): unknown;
  /** How many vocabulary entries carry usable bytes — reported, not assumed. */
  usableTokens: number;
}

export interface LogitsModule {
  LogitsProcessor: new () => LogitsProcessorLike;
  LogitsProcessorList: new () => { push(processor: LogitsProcessorLike): void };
}

/**
 * Returns null when the tokenizer does not expose its byte-level vocabulary.
 * Constrained decoding is then OFF and says so, rather than being silently
 * skipped — an unconstrained answer badged as constrained would be the exact
 * dishonesty the rest of this codebase refuses.
 */
export function createConstrainer(module: LogitsModule, tokenizer: unknown): Constrainer | null {
  const read = readVocab(tokenizer);
  if (!read) return null;
  const index: VocabIndex = buildVocabIndex(read.vocab, read.eosIds);
  if (index.usable === 0) return null;
  return {
    usableTokens: index.usable,
    processorList(columns: ColumnInfo[]) {
      // Built per call: for a dozen columns this is well under a millisecond,
      // and a cache keyed on anything less than the columns' full content is a
      // staleness bug waiting for the first dataset that changes shape.
      const list = new module.LogitsProcessorList();
      list.push(createGrammarProcessor(module.LogitsProcessor, buildGrammar(columns), index));
      return list;
    },
  };
}

export interface InterpretResult {
  /** Null when the model's answer failed the grammar check — a refusal. */
  intent: Intent | null;
  /** What the model actually produced, kept for the honest "why" panel. */
  raw: string;
  ms: number;
}

/**
 * Qwen3 is a reasoning model: left to itself it opens a <think> block and
 * spends the whole token budget arguing with itself before answering. The chat
 * template turns that off when `enable_thinking` is explicitly false — so we
 * apply the template ourselves instead of handing the pipeline a message list
 * and hoping. Without this the model NEVER emits the JSON and every question
 * silently falls back to the parser.
 */
export function buildPrompt(
  generator: RawGenerator,
  question: string,
  columns: ColumnInfo[],
): string {
  return generator.tokenizer.apply_chat_template(
    [
      { role: 'system', content: buildSystemPrompt(columns) },
      { role: 'user', content: buildUserPrompt(question) },
    ],
    // `enable_thinking` is not in the library's option type, but every unknown
    // key is spread into the Jinja template — which is where Qwen3 reads it.
    { tokenize: false, add_generation_prompt: true, enable_thinking: false },
  ) as string;
}

/** One question, one query — or a refusal. Greedy: same question, same answer. */
export async function generateIntent(
  generator: RawGenerator,
  question: string,
  columns: ColumnInfo[],
  options: { constrain?: Constrainer | null } = {},
): Promise<InterpretResult> {
  const started = performance.now();
  const output = await generator(buildPrompt(generator, question, columns), {
    max_new_tokens: MAX_NEW_TOKENS,
    do_sample: false,
    return_full_text: false,
    ...(options.constrain ? { logits_processor: options.constrain.processorList(columns) } : {}),
  });
  const raw = output[0]?.generated_text ?? '';
  return { intent: intentFromCompletion(raw, columns), raw, ms: performance.now() - started };
}

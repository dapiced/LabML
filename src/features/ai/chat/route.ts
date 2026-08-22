/**
 * V27.1 — who reads the question, and in which order.
 *
 * The deterministic parser goes FIRST. It is exact by construction: it can
 * only ever name a column that exists and a value that actually occurs in it,
 * so when it understands a question, nothing should be allowed to override it.
 * Measured on the reference questions (PLAN § N, V27.1): asked first, the
 * local model replaced a correct `embark_town = Cherbourg` (168 rows) with
 * `embarked = Cherbourg` (0 rows) — confidently wrong where the keyword
 * grammar was right.
 *
 * The model is therefore a RESCUE, not a front door: it is asked only about
 * the questions the deterministic parser gives up on — which is exactly the
 * gap that justifies downloading it.
 */
import type { Intent } from '@/features/ai/chat/engine';

/** Which interpreter turned the question into a query (V27). */
export type ChatEngine = 'deterministic' | 'llm';

/**
 * What the badge under a bubble says. A refusal is NOT "read by the model":
 * when nobody understood, the badge says so — and says whether the model was
 * even consulted.
 */
export type AnsweredBy = ChatEngine | 'none' | 'none-both';

/**
 * A union, not a pair of loose fields: an answer always names the engine that
 * produced it, and a refusal can only ever name nobody. The types make the
 * dishonest combination — a refusal badged as read by the model — unwritable.
 */
export type Resolution =
  { intent: Intent; by: ChatEngine } | { intent: null; by: 'none' | 'none-both' };

/**
 * @param deterministic the keyword grammar — always tried, always first.
 * @param llm the local model, or null when it is off or not loaded. Called at
 *   most once, and only after the deterministic parser has refused.
 */
export async function resolveIntent(
  deterministic: () => Intent | null,
  llm: (() => Promise<Intent | null>) | null,
): Promise<Resolution> {
  const keyword = deterministic();
  if (keyword) return { intent: keyword, by: 'deterministic' };
  if (!llm) return { intent: null, by: 'none' };
  const rescued = await llm();
  if (rescued) return { intent: rescued, by: 'llm' };
  return { intent: null, by: 'none-both' };
}

/**
 * V31 (C) — the honest refusal.
 *
 * EfficientNet-Lite4 always answers. Fed a photograph of three people beside a
 * flip chart it returns « stage » at 36.7 %; fed an astronaut it returns
 * « football helmet » at 86.6 %. Neither is a mistake in the ordinary sense:
 * ImageNet-1k holds 1,000 labels, 118 of them dog breeds, and **not one for a
 * human being**. The network is being asked a question whose answer is absent
 * from its vocabulary, and a softmax over 1,000 classes cannot say so — it
 * renormalizes to 1 whatever it is shown.
 *
 * So the refusal has to come from outside the classifier. This module is that
 * outside: it reads the two detectors that DO know about people and the top-1
 * probability, and returns which of three things the page is allowed to claim.
 *
 * Both rules were chosen against the measured V31 bench (14 images, see
 * `corpus.ts`) rather than picked and hoped for:
 *
 *  - **Rule 1 — a human subject.** Fires when the object detector finds a
 *    person AND the face detector finds a face. Requiring *both* is what the
 *    measurement bought: YOLOX reported `person` on two images whose subject is
 *    not a person (a wine bottle, a red sports car) and UltraFace found zero
 *    faces on both, while it counted faces exactly on 10 of 10 images where a
 *    person had written the count down. Two independent detectors agreeing
 *    fires on all three human images of the corpus and on neither false
 *    positive. A person box alone would cost two correct answers.
 *
 *  - **Rule 2 — too unsure to name.** Fires below {@link CONFIDENCE_FLOOR}.
 *    On the corpus the lowest *correct* top-1 is 70.5 % and the highest
 *    incorrect one not already caught by rule 1 is 41.2 %, so a floor at 50 %
 *    catches both remaining failures (a handwritten note read as
 *    « semi-trailer truck », three cats read as « French Bulldog ») and costs
 *    zero correct answers. **That gap is estimated from fourteen images**: it
 *    is wide, but it is not a population statistic, and a fifteenth image could
 *    land inside it. The floor is stated here so it can be re-measured, not
 *    presented as a law.
 *
 * What the verdict does NOT do is hide the label. The top-5 stays on screen
 * with its probabilities; the verdict frames it — « here is the nearest of
 * 1,000 classes, and here is why it is not an answer ». Announcing beats
 * hiding: a hidden number cannot be checked.
 */
import type { DetectedBox } from '@/features/ai/vision/detect';

/** COCO class index of `person` — first entry of YOLOX's class list. */
export const PERSON_CLASS = 0;

/**
 * Below this top-1 probability the classifier is guessing among near-ties, and
 * naming the winner reads as a confidence it does not have. Measured on the
 * V31 corpus: no correct answer falls below 70.5 %, no wrong one rises above
 * 41.2 % once rule 1 has taken the human images.
 */
export const CONFIDENCE_FLOOR = 0.5;

export type VerdictKind =
  /** The label may be read as the answer. */
  | 'named'
  /** People are in the picture and ImageNet-1k has no class for them. */
  | 'no-class-for-people'
  /** Nothing in the thousand is likely enough to be worth naming. */
  | 'unsure';

export interface Verdict {
  kind: VerdictKind;
  /** People the object detector found — the count the message quotes. */
  people: number;
  /** Faces the face detector found. */
  faces: number;
  /** Top-1 probability, carried so the UI names the number it judged. */
  p: number;
}

/**
 * Decide what the page is allowed to claim about the main subject.
 *
 * Pure and dependency-free — the same function runs in the browser and in the
 * unit tests, so the rule that ships is the rule that is checked. Rule 1 wins
 * over rule 2: on a human image the *reason* the label is wrong is the missing
 * class, not a shaky probability, and « football helmet » at 86.6 % would slip
 * straight through a confidence floor.
 */
export function judgeSubject(
  top: readonly { p: number }[],
  objects: readonly DetectedBox[],
  faces: readonly DetectedBox[],
): Verdict {
  const people = objects.filter((box) => box.classIndex === PERSON_CLASS).length;
  const p = top[0]?.p ?? 0;
  const base = { people, faces: faces.length, p };
  if (people > 0 && faces.length > 0) return { ...base, kind: 'no-class-for-people' };
  if (p < CONFIDENCE_FLOOR) return { ...base, kind: 'unsure' };
  return { ...base, kind: 'named' };
}

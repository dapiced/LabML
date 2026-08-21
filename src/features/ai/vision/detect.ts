/**
 * Hand-written post-processing for the two V23 detectors. Everything here is
 * pure math on Float32Arrays — no runtime dependency — so the exact box
 * pipeline (grid decode, IoU, NMS) is unit-testable and deterministic: same
 * tensors in, same boxes out, ties broken by index order.
 */

export interface DetectedBox {
  /** Corners in original-image pixels, clamped to the image. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Confidence in [0,1] (objectness × class for YOLOX, face score for UltraFace). */
  score: number;
  /** COCO class index for objects; always 0 for faces. */
  classIndex: number;
}

export const YOLOX_SIZE = 416;
export const YOLOX_CLASSES = 80;
/** Below this confidence a candidate box is noise, not a detection. */
export const OBJECT_THRESHOLD = 0.35;
/**
 * Real faces score ≥ 0.95 with UltraFace; measured false positives on
 * non-face content (animal ears, fabric folds) top out around 0.85.
 */
export const FACE_THRESHOLD = 0.9;
/** More boxes than this stops being a reading and becomes wallpaper. */
const MAX_BOXES = 24;

const OBJECT_IOU = 0.45;
const FACE_IOU = 0.3;

/** Intersection over union of two corner-form boxes. */
export function iou(a: DetectedBox, b: DetectedBox): number {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (areaA + areaB - inter);
}

/**
 * Hard non-maximum suppression: greedily keep the best-scoring box, drop
 * every remaining box overlapping it beyond the threshold. Sort ties break
 * by original index so the result never depends on engine sort stability.
 */
export function nms(boxes: DetectedBox[], iouThreshold: number): DetectedBox[] {
  const order = boxes
    .map((box, index) => ({ box, index }))
    .sort((a, b) => b.box.score - a.box.score || a.index - b.index);
  const kept: DetectedBox[] = [];
  for (const { box } of order) {
    if (kept.every((k) => iou(k, box) <= iouThreshold)) kept.push(box);
  }
  return kept;
}

const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);

/**
 * Decode YOLOX's raw head output [1, 3549, 85] (416² input, strides 8/16/32,
 * grid sizes 52/26/13). Per anchor: cx=(v0+gx)·stride, cy=(v1+gy)·stride,
 * w=exp(v2)·stride, h=exp(v3)·stride; objectness and the 80 class scores are
 * already sigmoided in the export, so confidence = obj · best class. Boxes
 * come back in original-image pixels: the page letterboxes the image with
 * `ratio = min(416/w, 416/h)` anchored top-left, so dividing by the ratio
 * undoes it. NMS runs per class (a dog box must not suppress a person box).
 */
export function decodeYolox(
  output: Float32Array,
  ratio: number,
  width: number,
  height: number,
  threshold = OBJECT_THRESHOLD,
): DetectedBox[] {
  const candidates: DetectedBox[] = [];
  const stride = [8, 16, 32];
  let anchor = 0;
  for (let level = 0; level < stride.length; level++) {
    const s = stride[level];
    const grid = YOLOX_SIZE / s;
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++, anchor++) {
        const base = anchor * (YOLOX_CLASSES + 5);
        const obj = output[base + 4];
        if (obj < threshold) continue; // class scores are ≤ 1: obj alone caps the confidence
        let best = 0;
        let bestClass = 0;
        for (let c = 0; c < YOLOX_CLASSES; c++) {
          const p = output[base + 5 + c];
          if (p > best) {
            best = p;
            bestClass = c;
          }
        }
        const score = obj * best;
        if (score < threshold) continue;
        const cx = (output[base] + gx) * s;
        const cy = (output[base + 1] + gy) * s;
        const w = Math.exp(output[base + 2]) * s;
        const h = Math.exp(output[base + 3]) * s;
        candidates.push({
          x1: clamp((cx - w / 2) / ratio, width),
          y1: clamp((cy - h / 2) / ratio, height),
          x2: clamp((cx + w / 2) / ratio, width),
          y2: clamp((cy + h / 2) / ratio, height),
          score,
          classIndex: bestClass,
        });
      }
    }
  }

  const byClass = new Map<number, DetectedBox[]>();
  for (const box of candidates) {
    const list = byClass.get(box.classIndex);
    if (list) list.push(box);
    else byClass.set(box.classIndex, [box]);
  }
  const kept: DetectedBox[] = [];
  for (const list of byClass.values()) kept.push(...nms(list, OBJECT_IOU));
  return kept.sort((a, b) => b.score - a.score || a.x1 - b.x1).slice(0, MAX_BOXES);
}

export const ULTRA_INPUT_W = 320;
export const ULTRA_INPUT_H = 240;

/**
 * Decode UltraFace RFB-320: `scores` [1, 4420, 2] (background, face) and
 * `boxes` [1, 4420, 4] as corners normalized to the 320×240 input. The page
 * letterboxes the photo into that input (aspect preserved, top-left anchored,
 * `ratio = min(320/w, 240/h)`) — squashing tall portraits instead measurably
 * mislocates the face box — so corners map back through input px ÷ ratio.
 */
export function decodeUltraface(
  scores: Float32Array,
  boxes: Float32Array,
  ratio: number,
  width: number,
  height: number,
  threshold = FACE_THRESHOLD,
): DetectedBox[] {
  const candidates: DetectedBox[] = [];
  const count = scores.length / 2;
  for (let i = 0; i < count; i++) {
    const score = scores[i * 2 + 1];
    if (score < threshold) continue;
    candidates.push({
      x1: clamp((boxes[i * 4] * ULTRA_INPUT_W) / ratio, width),
      y1: clamp((boxes[i * 4 + 1] * ULTRA_INPUT_H) / ratio, height),
      x2: clamp((boxes[i * 4 + 2] * ULTRA_INPUT_W) / ratio, width),
      y2: clamp((boxes[i * 4 + 3] * ULTRA_INPUT_H) / ratio, height),
      score,
      classIndex: 0,
    });
  }
  return nms(candidates, FACE_IOU).slice(0, MAX_BOXES);
}

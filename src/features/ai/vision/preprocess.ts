export const VISION_SIZE = 224;

/** ImageNet channel statistics used by SqueezeNet (values in 0–1 space). */
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/**
 * RGBA pixels (canvas ImageData) → normalized NCHW Float32 tensor [1,3,H,W].
 * Pure function so the math is unit-testable without a DOM canvas.
 */
export function tensorFromRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const plane = width * height;
  const tensor = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let channel = 0; channel < 3; channel++) {
      tensor[channel * plane + i] = (data[i * 4 + channel] / 255 - MEAN[channel]) / STD[channel];
    }
  }
  return tensor;
}

/** Softmax over raw scores, returning the k most probable indices. */
export function softmaxTop(scores: ArrayLike<number>, k: number): { index: number; p: number }[] {
  let max = -Infinity;
  for (let i = 0; i < scores.length; i++) max = Math.max(max, scores[i]);
  const exps = new Float64Array(scores.length);
  let sum = 0;
  for (let i = 0; i < scores.length; i++) {
    exps[i] = Math.exp(scores[i] - max);
    sum += exps[i];
  }
  return [...exps]
    .map((value, index) => ({ index, p: value / sum }))
    .sort((a, b) => b.p - a.p)
    .slice(0, k);
}

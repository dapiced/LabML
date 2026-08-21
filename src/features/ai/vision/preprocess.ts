/** Input sizes of the three self-hosted models. */
export const VISION_SIZE = 224; // EfficientNet-Lite4 classifier
export const YOLOX_INPUT = 416; // YOLOX-Nano object detector (square letterbox)
export const ULTRA_W = 320; // UltraFace face detector
export const ULTRA_H = 240;

/**
 * RGBA pixels → EfficientNet-Lite tensor: NHWC [1,H,W,3], RGB order,
 * EdgeTPU-style normalization (x − 127) / 128. Pure function so the math is
 * unit-testable without a DOM canvas.
 */
export function liteTensorFromRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const tensor = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    for (let channel = 0; channel < 3; channel++) {
      tensor[i * 3 + channel] = (data[i * 4 + channel] - 127) / 128;
    }
  }
  return tensor;
}

/**
 * RGBA pixels → YOLOX tensor: NCHW [1,3,H,W], **BGR** order, raw 0–255
 * values (YOLOX dropped mean/std normalization and is trained on OpenCV's
 * BGR frames — feeding RGB silently costs accuracy).
 */
export function yoloxTensorFromRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const plane = width * height;
  const tensor = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    tensor[i] = data[i * 4 + 2]; // B
    tensor[plane + i] = data[i * 4 + 1]; // G
    tensor[2 * plane + i] = data[i * 4]; // R
  }
  return tensor;
}

/**
 * RGBA pixels → UltraFace tensor: NCHW [1,3,H,W], RGB order, (x − 127) / 128.
 */
export function ultraTensorFromRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const plane = width * height;
  const tensor = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let channel = 0; channel < 3; channel++) {
      tensor[channel * plane + i] = (data[i * 4 + channel] - 127) / 128;
    }
  }
  return tensor;
}

/**
 * The k most probable indices of an already-normalized probability vector
 * (EfficientNet-Lite ends in a Softmax node — re-softmaxing would flatten it).
 */
export function topK(probs: ArrayLike<number>, k: number): { index: number; p: number }[] {
  return Array.from(probs, (p, index) => ({ index, p }))
    .sort((a, b) => b.p - a.p || a.index - b.index)
    .slice(0, k);
}

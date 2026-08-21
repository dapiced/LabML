import { describe, expect, it } from 'vitest';
import {
  liteTensorFromRgba,
  topK,
  ultraTensorFromRgba,
  VISION_SIZE,
  yoloxTensorFromRgba,
} from './preprocess';

describe('liteTensorFromRgba (EfficientNet-Lite)', () => {
  it('normalizes a single pixel as (x − 127) / 128, RGB interleaved', () => {
    const rgba = new Uint8ClampedArray([255, 128, 0, 255]);
    const tensor = liteTensorFromRgba(rgba, 1, 1);

    expect(tensor).toHaveLength(3);
    expect(tensor[0]).toBeCloseTo((255 - 127) / 128, 6);
    expect(tensor[1]).toBeCloseTo((128 - 127) / 128, 6);
    expect(tensor[2]).toBeCloseTo((0 - 127) / 128, 6);
  });

  it('lays pixels out interleaved (NHWC), not as planes', () => {
    // 2×1 image: pure red pixel then pure blue pixel.
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
    const tensor = liteTensorFromRgba(rgba, 2, 1);

    expect(tensor).toHaveLength(6);
    // Pixel 0 = [R,G,B] then pixel 1 = [R,G,B].
    expect(tensor[0]).toBeCloseTo(1, 6);
    expect(tensor[2]).toBeCloseTo(-127 / 128, 6);
    expect(tensor[3]).toBeCloseTo(-127 / 128, 6);
    expect(tensor[5]).toBeCloseTo(1, 6);
  });

  it('ignores the alpha channel entirely', () => {
    const opaque = liteTensorFromRgba(new Uint8ClampedArray([10, 20, 30, 255]), 1, 1);
    const transparent = liteTensorFromRgba(new Uint8ClampedArray([10, 20, 30, 0]), 1, 1);
    expect([...opaque]).toEqual([...transparent]);
  });

  it('produces a full-size classifier input tensor', () => {
    const rgba = new Uint8ClampedArray(VISION_SIZE * VISION_SIZE * 4);
    expect(liteTensorFromRgba(rgba, VISION_SIZE, VISION_SIZE)).toHaveLength(
      3 * VISION_SIZE * VISION_SIZE,
    );
  });
});

describe('yoloxTensorFromRgba', () => {
  it('keeps raw 0–255 values in BGR planes (NCHW)', () => {
    // 2×1 image: pure red pixel then pure green pixel.
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 200, 0, 255]);
    const tensor = yoloxTensorFromRgba(rgba, 2, 1);

    expect(tensor).toHaveLength(6);
    // Plane order B, G, R — red lands in the LAST plane.
    expect([...tensor.slice(0, 2)]).toEqual([0, 0]); // B plane
    expect([...tensor.slice(2, 4)]).toEqual([0, 200]); // G plane
    expect([...tensor.slice(4, 6)]).toEqual([255, 0]); // R plane
  });
});

describe('ultraTensorFromRgba', () => {
  it('normalizes as (x − 127) / 128 in RGB planes (NCHW)', () => {
    const rgba = new Uint8ClampedArray([255, 127, 0, 255]);
    const tensor = ultraTensorFromRgba(rgba, 1, 1);

    expect(tensor).toHaveLength(3);
    expect(tensor[0]).toBeCloseTo(1, 6);
    expect(tensor[1]).toBeCloseTo(0, 6);
    expect(tensor[2]).toBeCloseTo(-127 / 128, 6);
  });
});

describe('topK', () => {
  it('returns the k most probable indices without re-normalizing', () => {
    const top = topK([0.1, 0.6, 0.3], 2);
    expect(top.map((item) => item.index)).toEqual([1, 2]);
    expect(top[0].p).toBeCloseTo(0.6, 6);
    expect(top[1].p).toBeCloseTo(0.3, 6);
  });

  it('breaks ties by index order, deterministically', () => {
    const top = topK([0.5, 0.5], 2);
    expect(top.map((item) => item.index)).toEqual([0, 1]);
  });
});

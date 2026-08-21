import { describe, expect, it } from 'vitest';
import { softmaxTop, tensorFromRgba, VISION_SIZE } from './preprocess';

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

describe('tensorFromRgba', () => {
  it('normalizes a single pixel with the ImageNet statistics', () => {
    const rgba = new Uint8ClampedArray([255, 128, 0, 255]);
    const tensor = tensorFromRgba(rgba, 1, 1);

    expect(tensor).toHaveLength(3);
    expect(tensor[0]).toBeCloseTo((1 - MEAN[0]) / STD[0], 5);
    expect(tensor[1]).toBeCloseTo((128 / 255 - MEAN[1]) / STD[1], 5);
    expect(tensor[2]).toBeCloseTo((0 - MEAN[2]) / STD[2], 5);
  });

  it('lays pixels out as planes (NCHW), not interleaved', () => {
    // 2×1 image: pure red pixel then pure blue pixel.
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
    const tensor = tensorFromRgba(rgba, 2, 1);

    expect(tensor).toHaveLength(6);
    // Red plane: [red@p0, red@p1], blue plane: [blue@p0, blue@p1].
    expect(tensor[0]).toBeCloseTo((1 - MEAN[0]) / STD[0], 5);
    expect(tensor[1]).toBeCloseTo((0 - MEAN[0]) / STD[0], 5);
    expect(tensor[4]).toBeCloseTo((0 - MEAN[2]) / STD[2], 5);
    expect(tensor[5]).toBeCloseTo((1 - MEAN[2]) / STD[2], 5);
  });

  it('ignores the alpha channel entirely', () => {
    const opaque = tensorFromRgba(new Uint8ClampedArray([10, 20, 30, 255]), 1, 1);
    const transparent = tensorFromRgba(new Uint8ClampedArray([10, 20, 30, 0]), 1, 1);
    expect([...opaque]).toEqual([...transparent]);
  });

  it('produces a full-size SqueezeNet input tensor', () => {
    const rgba = new Uint8ClampedArray(VISION_SIZE * VISION_SIZE * 4);
    expect(tensorFromRgba(rgba, VISION_SIZE, VISION_SIZE)).toHaveLength(
      3 * VISION_SIZE * VISION_SIZE,
    );
  });
});

describe('softmaxTop', () => {
  it('returns the k most probable indices, sorted by probability', () => {
    const top = softmaxTop([1, 3, 2, 0], 2);
    expect(top.map((item) => item.index)).toEqual([1, 2]);
    expect(top[0].p).toBeGreaterThan(top[1].p);
  });

  it('computes true softmax probabilities', () => {
    const top = softmaxTop([0, 1, 2], 3);
    const denominator = Math.exp(0) + Math.exp(1) + Math.exp(2);
    expect(top[0].index).toBe(2);
    expect(top[0].p).toBeCloseTo(Math.exp(2) / denominator, 6);
    expect(top.reduce((sum, item) => sum + item.p, 0)).toBeCloseTo(1, 6);
  });

  it('is numerically stable on large logits', () => {
    const top = softmaxTop([1000, 999], 2);
    expect(Number.isFinite(top[0].p)).toBe(true);
    expect(top[0].index).toBe(0);
    expect(top[0].p).toBeCloseTo(Math.exp(0) / (Math.exp(0) + Math.exp(-1)), 6);
  });

  it('splits a tie uniformly', () => {
    const top = softmaxTop([5, 5], 2);
    expect(top[0].p).toBeCloseTo(0.5, 6);
    expect(top[1].p).toBeCloseTo(0.5, 6);
  });
});

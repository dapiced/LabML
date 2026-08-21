import { describe, expect, it } from 'vitest';
import { decodeUltraface, decodeYolox, iou, nms, YOLOX_CLASSES, type DetectedBox } from './detect';

const box = (x1: number, y1: number, x2: number, y2: number, score = 1, classIndex = 0) =>
  ({ x1, y1, x2, y2, score, classIndex }) satisfies DetectedBox;

describe('iou', () => {
  it('is 1 for identical boxes and 0 for disjoint boxes', () => {
    expect(iou(box(0, 0, 10, 10), box(0, 0, 10, 10))).toBe(1);
    expect(iou(box(0, 0, 10, 10), box(20, 20, 30, 30))).toBe(0);
  });

  it('computes a known partial overlap exactly', () => {
    // 10×10 boxes offset by 5: intersection 25, union 175.
    expect(iou(box(0, 0, 10, 10), box(5, 5, 15, 15))).toBeCloseTo(25 / 175, 6);
  });
});

describe('nms', () => {
  it('keeps the best box and suppresses heavy overlaps', () => {
    const kept = nms(
      [box(0, 0, 10, 10, 0.9), box(1, 1, 11, 11, 0.8), box(30, 30, 40, 40, 0.7)],
      0.45,
    );
    expect(kept.map((b) => b.score)).toEqual([0.9, 0.7]);
  });

  it('breaks score ties by original index, deterministically', () => {
    const first = box(0, 0, 10, 10, 0.8);
    const second = box(0, 0, 10, 10, 0.8);
    const kept = nms([first, second], 0.45);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toBe(first); // the earlier of the two ties survives
  });
});

/** Build an empty YOLOX output [3549 × 85] and plant one detection in it. */
function yoloxOutput(): Float32Array {
  return new Float32Array(3549 * (YOLOX_CLASSES + 5));
}

function plant(
  output: Float32Array,
  anchor: number,
  values: { dx: number; dy: number; w: number; h: number; obj: number; cls: number; p: number },
) {
  const base = anchor * (YOLOX_CLASSES + 5);
  output[base] = values.dx;
  output[base + 1] = values.dy;
  output[base + 2] = values.w;
  output[base + 3] = values.h;
  output[base + 4] = values.obj;
  output[base + 5 + values.cls] = values.p;
}

describe('decodeYolox', () => {
  it('decodes a stride-8 anchor through grid, exp and the letterbox ratio', () => {
    const output = yoloxOutput();
    // Grid 52×52 (stride 8): anchor at (gx=10, gy=4) → index 4·52 + 10.
    plant(output, 4 * 52 + 10, {
      dx: 0.5,
      dy: 0.25,
      w: Math.log(4), // exp → 4·8 = 32 px wide in the 416 input
      h: Math.log(2), // exp → 16 px tall
      obj: 0.9,
      cls: 16, // dog
      p: 0.8,
    });
    const ratio = 0.5; // image was downscaled ×0.5 into the letterbox
    const [detection, ...rest] = decodeYolox(output, ratio, 800, 600);

    expect(rest).toHaveLength(0);
    expect(detection.classIndex).toBe(16);
    expect(detection.score).toBeCloseTo(0.72, 6);
    // cx = (0.5+10)·8 = 84, cy = (0.25+4)·8 = 34 in input space → /ratio.
    expect(detection.x1).toBeCloseTo((84 - 16) / 0.5, 4);
    expect(detection.x2).toBeCloseTo((84 + 16) / 0.5, 4);
    expect(detection.y1).toBeCloseTo((34 - 8) / 0.5, 4);
    expect(detection.y2).toBeCloseTo((34 + 8) / 0.5, 4);
  });

  it('drops candidates whose obj × class score is below the threshold', () => {
    const output = yoloxOutput();
    plant(output, 0, { dx: 0, dy: 0, w: 0, h: 0, obj: 0.5, cls: 0, p: 0.5 }); // 0.25 < 0.35
    expect(decodeYolox(output, 1, 416, 416)).toHaveLength(0);
  });

  it('suppresses same-class overlaps but keeps other classes', () => {
    const output = yoloxOutput();
    const at = (gx: number, gy: number) => gy * 52 + gx;
    const big = { dx: 0, dy: 0, w: Math.log(8), h: Math.log(8), obj: 0.9 };
    // Two overlapping dogs on neighboring anchors + one person on the same spot.
    plant(output, at(10, 10), { ...big, cls: 16, p: 0.9 });
    plant(output, at(11, 10), { ...big, cls: 16, p: 0.7 });
    plant(output, at(10, 10), { ...big, cls: 0, p: 0.85 }); // same anchor: argmax picks the dog
    plant(output, at(12, 10), { ...big, cls: 0, p: 0.85 });

    const kept = decodeYolox(output, 1, 416, 416);
    const dogs = kept.filter((b) => b.classIndex === 16);
    const people = kept.filter((b) => b.classIndex === 0);
    expect(dogs).toHaveLength(1);
    expect(dogs[0].score).toBeCloseTo(0.81, 6);
    expect(people).toHaveLength(1);
  });

  it('clamps boxes to the image bounds', () => {
    const output = yoloxOutput();
    plant(output, 0, { dx: 0, dy: 0, w: Math.log(20), h: Math.log(20), obj: 0.9, cls: 2, p: 0.9 });
    const [detection] = decodeYolox(output, 1, 416, 416);
    expect(detection.x1).toBe(0); // cx=0 − 80 px clamps to the left edge
    expect(detection.y1).toBe(0);
  });
});

describe('decodeUltraface', () => {
  const scoresOf = (faces: number[]) => {
    const scores = new Float32Array(faces.length * 2);
    faces.forEach((p, i) => {
      scores[i * 2] = 1 - p;
      scores[i * 2 + 1] = p;
    });
    return scores;
  };

  it('maps normalized corners back through the letterbox ratio and filters by score', () => {
    const scores = scoresOf([0.95, 0.4]);
    const boxes = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.5, 0.9, 0.9]);
    // 640×480 image → ratio min(320/640, 240/480) = 0.5.
    const faces = decodeUltraface(scores, boxes, 0.5, 640, 480);

    expect(faces).toHaveLength(1);
    expect(faces[0].score).toBeCloseTo(0.95, 6);
    expect(faces[0].x1).toBeCloseTo(64, 4);
    expect(faces[0].y1).toBeCloseTo(96, 4);
    expect(faces[0].x2).toBeCloseTo(192, 4);
    expect(faces[0].y2).toBeCloseTo(192, 4);
  });

  it('merges duplicate anchors over the same face via NMS', () => {
    const scores = scoresOf([0.95, 0.9]);
    const boxes = new Float32Array([0.1, 0.1, 0.3, 0.3, 0.11, 0.11, 0.31, 0.31]);
    expect(decodeUltraface(scores, boxes, 1, 320, 240)).toHaveLength(1);
  });

  it('clamps out-of-frame corners to the image', () => {
    const scores = scoresOf([0.99]);
    const boxes = new Float32Array([-0.1, -0.2, 1.2, 1.1]);
    const [face] = decodeUltraface(scores, boxes, 1, 320, 240);
    expect(face.x1).toBe(0);
    expect(face.y1).toBe(0);
    expect(face.x2).toBe(320);
    expect(face.y2).toBe(240);
  });
});

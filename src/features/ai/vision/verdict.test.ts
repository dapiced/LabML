import { describe, expect, it } from 'vitest';
import type { DetectedBox } from './detect';
import { CONFIDENCE_FLOOR, judgeSubject, PERSON_CLASS } from './verdict';

const box = (classIndex: number, score = 0.9): DetectedBox => ({
  x1: 0,
  y1: 0,
  x2: 10,
  y2: 10,
  score,
  classIndex,
});

const person = () => box(PERSON_CLASS);
const face = () => box(0);
const CAT = 15; // COCO `cat`

describe('judgeSubject', () => {
  it('names the label when the classifier is confident and no human is in frame', () => {
    const verdict = judgeSubject([{ p: 0.93 }], [box(CAT)], []);
    expect(verdict.kind).toBe('named');
    expect(verdict.people).toBe(0);
  });

  it('refuses to name a human subject — ImageNet-1k has no class for one', () => {
    // group_people.jpg: « stage » at 36.7 %, 3 people, 3 faces.
    const verdict = judgeSubject(
      [{ p: 0.367 }],
      [person(), person(), person()],
      [face(), face(), face()],
    );
    expect(verdict.kind).toBe('no-class-for-people');
    expect(verdict.people).toBe(3);
    expect(verdict.faces).toBe(3);
  });

  it('refuses on a human subject even when the label is very confident', () => {
    // astronaut.jpg: « football helmet » at 86.6 % — far above the floor, so
    // rule 1 has to win over rule 2 or this one ships as an answer.
    expect(judgeSubject([{ p: 0.866 }], [person()], [face()]).kind).toBe('no-class-for-people');
  });

  it('does not fire on a person box the face detector contradicts', () => {
    // wine_bottle.jpg and sports_car.jpg both draw a `person` box on content
    // that is not a person; UltraFace finds no face on either. Requiring both
    // detectors is what keeps these two correct answers.
    expect(judgeSubject([{ p: 0.705 }], [person()], []).kind).toBe('named');
  });

  it('says it is unsure below the measured confidence floor', () => {
    // handwriting.jpg: « semi-trailer truck » at 41.2 %, nothing detected.
    const verdict = judgeSubject([{ p: 0.412 }], [], []);
    expect(verdict.kind).toBe('unsure');
    expect(verdict.p).toBeCloseTo(0.412, 6);
  });

  it('puts the floor strictly below the lowest correct answer of the corpus', () => {
    // A regression guard on the constant itself: 70.5 % (sports_car,
    // « convertible ») is the cheapest correct answer measured. A floor raised
    // to or above it starts refusing answers that were right.
    expect(CONFIDENCE_FLOOR).toBeLessThan(0.705);
    expect(judgeSubject([{ p: CONFIDENCE_FLOOR }], [], []).kind).toBe('named');
    expect(judgeSubject([{ p: CONFIDENCE_FLOOR - 1e-6 }], [], []).kind).toBe('unsure');
  });

  it('treats an empty prediction list as unsure rather than crashing', () => {
    expect(judgeSubject([], [], []).kind).toBe('unsure');
  });
});

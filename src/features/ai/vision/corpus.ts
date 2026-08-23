/**
 * V31 — the vision bench: what the playground is actually asked, and what a
 * person sees when they look at the same picture.
 *
 * The owner's report was « better than the chat, but it still makes mistakes ».
 * That is not a measurable statement, and V30 taught the cost of acting on one:
 * the wave's premise was wrong and only the instrument said so. So this file
 * comes first.
 *
 * **Every image here was looked at.** Not searched for and trusted — opened and
 * examined, because a corpus whose ground truth is a guess measures the guess.
 * That is also why there are fourteen of them and not the thirty to fifty the
 * plan asked for: a search-and-hope pipeline produced silhouetted dogs, a
 * triptych of broccoli close-ups and an eighteenth-century painting of a
 * lighthouse, all of which would have scored the model wrong for the corpus's
 * mistakes. Fewer, verified, is the instrument; more, unverified, is noise with
 * a percentage attached. The narrowness is stated here rather than hidden.
 *
 * Licences: every file is CC0, public domain, or CC BY — never CC BY-SA, whose
 * share-alike term would propagate into an MIT repository. Sources and authors
 * are in `SOURCES.json` beside the images.
 */

export interface VisionCase {
  /** Path relative to the repo root, as Playwright's setInputFiles wants it. */
  file: string;
  /** What a person sees. Written down so the expectation can be re-checked. */
  describes: string;
  /**
   * ImageNet-1k labels that would make a correct top-1 answer.
   *
   * **An EMPTY list is the point of this wave.** It means no label in the
   * thousand can name what the picture shows — most often because the subject
   * is a human being, and ImageNet-1k has no « person » class at all: 1000
   * labels, 118 of them dog breeds, none for a person. On those images the
   * classifier is not wrong, it is being asked a question whose answer is
   * absent from its vocabulary, and the only honest output is a refusal.
   */
  accept: string[];
  /** COCO classes a person can count, with the minimum the detector should find. */
  objects?: Record<string, number>;
  /** Faces a person counts. Stated only where it was unambiguous by eye. */
  faces?: number;
}

export const VISION_CASES: VisionCase[] = [
  // --- ImageNet can name it -------------------------------------------
  {
    file: 'e2e/fixtures/vision/pizza.jpg',
    describes: 'a whole cheese pizza on a paper plate, seen from above',
    accept: ['pizza'],
    faces: 0,
  },
  {
    file: 'e2e/fixtures/vision/soccer_ball.jpg',
    describes: 'a white and yellow football lying on grass',
    accept: ['soccer ball'],
    objects: { 'sports ball': 1 },
    faces: 0,
  },
  {
    file: 'e2e/fixtures/vision/teapot.jpg',
    describes: 'a white porcelain teapot with painted flowers, on a grey ground',
    accept: ['teapot'],
    faces: 0,
  },
  {
    file: 'e2e/fixtures/vision/goldfish.jpg',
    describes: 'an orange goldfish just under the surface of a pond',
    accept: ['goldfish'],
    faces: 0,
  },
  {
    file: 'e2e/fixtures/vision/wine_bottle.jpg',
    describes: 'a dark wine bottle and a full glass of red wine',
    accept: ['wine bottle', 'red wine', 'goblet'],
    objects: { bottle: 1 },
    faces: 0,
  },
  {
    file: 'e2e/fixtures/vision/airliner.jpg',
    describes: 'a bulbous cargo aircraft in flight against a dark sky',
    accept: ['airliner', 'warplane'],
    objects: { airplane: 1 },
    faces: 0,
  },
  {
    file: 'e2e/fixtures/vision/school_bus.jpg',
    describes: 'a yellow American school bus parked on a street',
    accept: ['school bus'],
    objects: { bus: 1 },
  },
  {
    file: 'e2e/fixtures/vision/strawberry.jpg',
    describes: 'strawberries in punnets on a market stall',
    accept: ['strawberry'],
    faces: 0,
  },
  {
    file: 'e2e/fixtures/vision/sports_car.jpg',
    describes: 'a red sports car parked beside a brick building',
    accept: ['sports car', 'convertible', 'beach wagon'],
    objects: { car: 1 },
  },
  {
    file: 'e2e/fixtures/vision/cats_sofa.jpg',
    describes: 'three cats — orange tabby, black, white — asleep on a sofa',
    accept: ['tabby cat', 'tiger cat', 'Egyptian Mau'],
    objects: { cat: 2 },
    faces: 0,
  },

  // --- ImageNet CANNOT name it: the defect this wave is about -----------
  {
    file: 'e2e/fixtures/vision/group_people.jpg',
    describes: 'three people standing beside a flip chart in a workshop',
    accept: [],
    objects: { person: 3 },
    faces: 3,
  },
  {
    file: 'e2e/fixtures/vision/umbrella_group.jpg',
    describes: 'several people under a large black umbrella, beside a car',
    accept: [],
    objects: { person: 3, umbrella: 1 },
  },
  {
    file: 'e2e/fixtures/vision/handwriting.jpg',
    describes: 'a spiral notebook on gravel with « BEACH HOUSE » written by hand',
    accept: [],
  },
  {
    // Already in the repo since V23 — NASA portrait of Cdr. Eileen Collins.
    file: 'e2e/fixtures/astronaut.jpg',
    describes: 'a portrait of an astronaut in a flight suit',
    accept: [],
    objects: { person: 1 },
    faces: 1,
  },
];

/** How many of the corpus's images have no correct ImageNet answer at all. */
export function unnameableCount(cases: readonly VisionCase[] = VISION_CASES): number {
  return cases.filter((entry) => entry.accept.length === 0).length;
}

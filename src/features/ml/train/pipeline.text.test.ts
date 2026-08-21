import { describe, expect, it } from 'vitest';
import { computeInsights, encodedBlocks, wordEffects } from './insights';
import { buildRowEncoder, fitPipeline, specsFromJson, specsToJson } from './pipeline';
import { runTraining } from './trainer';
import type { Cell, ColumnProfile } from '@/features/ml/data/types';

/** Tiny bilingual review corpus: the words carry the label, the number does not. */
const REVIEWS = [
  'delivery was fast and the quality is excellent',
  'livraison rapide et la qualite est excellente',
  'arrived broken and the quality is poor',
  'arrive casse et la qualite est mauvaise',
  'shipping was fast, excellent quality overall',
  'expedition rapide, excellente qualite',
  'broken on arrival, poor quality',
  'casse a la livraison, mauvaise qualite',
];
const LABELS = ['yes', 'yes', 'no', 'no', 'yes', 'yes', 'no', 'no'];

function fixture(): { columns: Map<string, Cell[]>; profiles: ColumnProfile[] } {
  const columns = new Map<string, Cell[]>([
    ['review', REVIEWS],
    ['amount', REVIEWS.map((_, i) => String(10 + i))],
    ['happy', LABELS],
  ]);
  const profiles: ColumnProfile[] = [
    { name: 'review', type: 'text', rowCount: 8, missingCount: 0, cardinality: 8 },
    { name: 'amount', type: 'numeric', rowCount: 8, missingCount: 0, cardinality: 8 },
    { name: 'happy', type: 'categorical', rowCount: 8, missingCount: 0, cardinality: 2 },
  ];
  return { columns, profiles };
}

describe('text columns in the pipeline', () => {
  const { columns, profiles } = fixture();
  const trainIndices = [0, 1, 2, 3, 4, 5, 6, 7];
  const pipeline = fitPipeline(columns, profiles, ['review', 'amount'], trainIndices);
  const textSpec = pipeline.specs.find((spec) => spec.kind === 'text');

  it('fits a TF-IDF spec instead of frequency-ranking whole sentences', () => {
    expect(textSpec).toBeDefined();
    expect(pipeline.specs.some((spec) => spec.kind === 'ordinal')).toBe(false);
    if (textSpec?.kind !== 'text') throw new Error('expected a text spec');
    expect(textSpec.terms.length).toBeGreaterThan(3);
    expect(textSpec.terms).toContain('qualite');
    expect(textSpec.idf).toHaveLength(textSpec.terms.length);
  });

  it('names every text feature `column:word`, so explanations read as words', () => {
    const wordFeatures = pipeline.featureNames.filter((name) => name.startsWith('review:'));
    if (textSpec?.kind !== 'text') throw new Error('expected a text spec');
    expect(wordFeatures).toHaveLength(textSpec.terms.length);
    expect(wordFeatures).toContain(`review:${textSpec.terms[0]}`);
    // The numeric column keeps its plain name.
    expect(pipeline.featureNames).toContain('amount');
  });

  it('encodes the whole vocabulary as one block, in feature order', () => {
    const row = pipeline.transformRow({ review: REVIEWS[0], amount: '10' });
    expect(row).toHaveLength(pipeline.featureNames.length);
    const norm = Math.sqrt(
      row
        .slice(0, pipeline.featureNames.filter((n) => n.startsWith('review:')).length)
        .reduce((sum, v) => sum + v * v, 0),
    );
    expect(norm).toBeCloseTo(1, 10); // the text block is L2-normalized
  });

  it('gives a missing review an all-zero block rather than imputing words', () => {
    const row = pipeline.transformRow({ review: null, amount: '10' });
    const width = pipeline.featureNames.filter((n) => n.startsWith('review:')).length;
    expect(row.slice(0, width).every((value) => value === 0)).toBe(true);
  });

  it('reports the text block width in encodedBlocks, not 1', () => {
    if (textSpec?.kind !== 'text') throw new Error('expected a text spec');
    const blocks = encodedBlocks(pipeline);
    const reviewBlock = blocks.find((block) => block.column === 'review');
    const amountBlock = blocks.find((block) => block.column === 'amount');
    expect(reviewBlock?.width).toBe(textSpec.terms.length);
    // The block after it starts where the text block ends — no silent shift.
    expect(amountBlock?.start).toBe(reviewBlock!.start + reviewBlock!.width);
  });

  it('survives the JSON round-trip used by model export/import', () => {
    const restored = buildRowEncoder(specsFromJson(specsToJson(pipeline.specs)));
    expect(restored.featureNames).toEqual(pipeline.featureNames);
    const record = { review: REVIEWS[2], amount: '12' };
    expect(restored.transformRow(record)).toEqual(pipeline.transformRow(record));
  });

  it('fits the vocabulary on the train split only (no leakage from test rows)', () => {
    const trainOnly = fitPipeline(columns, profiles, ['review'], [0, 1]);
    const spec = trainOnly.specs.find((s) => s.kind === 'text');
    if (spec?.kind !== 'text') throw new Error('expected a text spec');
    // "broken" only appears in rows 2 and 6, which were not in the train split.
    expect(spec.terms).not.toContain('broken');
  });
});

describe('text columns end to end', () => {
  it('trains on a text column and lets the words explain the model', async () => {
    const { columns, profiles } = fixture();
    const outcome = await runTraining(
      columns,
      profiles,
      { target: 'happy', features: ['review', 'amount'], seed: 42, testRatio: 0.25 },
      { onModelStart: () => {}, onModelResult: () => {}, isCancelled: () => false },
    );
    expect(outcome).not.toBeNull();
    // Text is trainable now: it must not land in the skipped list.
    expect(outcome!.summary.skippedColumns).not.toContain('review');
    expect(outcome!.summary.featureColumns).toContain('review');
    expect(outcome!.summary.featureCount).toBeGreaterThan(2);

    const insights = computeInsights(outcome!.artifacts, 'logistic');
    expect(insights.importance.some((entry) => entry.column === 'review')).toBe(true);
    for (const word of insights.words ?? []) {
      expect(word.column).toBe('review');
      expect(word.term).not.toContain(' ');
      expect(word.rows).toBeGreaterThan(0);
    }
  });
});

describe('wordEffects', () => {
  const { columns, profiles } = fixture();
  const pipeline = fitPipeline(columns, profiles, ['review'], [0, 1, 2, 3, 4, 5, 6, 7]);
  const testX = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => pipeline.transformRow({ review: REVIEWS[i] }));

  /** Model whose positive-class probability is driven by one known term. */
  function probeModel(termIndex: number) {
    return {
      predict: (rows: number[][]) => rows.map((row) => (row[termIndex] > 0 ? 1 : 0)),
      predictProba: (rows: number[][]) =>
        rows.map((row) => {
          const p = row[termIndex] > 0 ? 0.9 : 0.1;
          return [1 - p, p];
        }),
    };
  }

  it('gives the driving word a positive effect, in the answer’s direction', () => {
    const spec = pipeline.specs[0];
    if (spec.kind !== 'text') throw new Error('expected a text spec');
    const termIndex = spec.terms.indexOf('qualite');
    expect(termIndex).toBeGreaterThanOrEqual(0);

    const effects = wordEffects(probeModel(termIndex) as never, pipeline, testX, true, 2);
    const driver = effects.find((entry) => entry.term === 'qualite');
    expect(driver).toBeDefined();
    // Erasing the word flips the answer down: keeping it pushes up.
    expect(driver!.effect).toBeCloseTo(0.8, 6);
    expect(effects[0].term).toBe('qualite'); // biggest magnitude first
  });

  it('refuses multiclass rather than faking a direction', () => {
    const effects = wordEffects(probeModel(0) as never, pipeline, testX, true, 3);
    expect(effects).toEqual([]);
  });

  it('returns nothing when the run has no text column', () => {
    const numericOnly = fitPipeline(columns, profiles, ['amount'], [0, 1, 2, 3]);
    const rows = [0, 1, 2, 3].map((i) => numericOnly.transformRow({ amount: String(10 + i) }));
    expect(wordEffects(probeModel(0) as never, numericOnly, rows, true, 2)).toEqual([]);
  });
});

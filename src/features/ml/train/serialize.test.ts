import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import { deserializeModel } from '@/features/ml/train/deserialize';
import { scoreBatch, scoreRows } from '@/features/ml/train/score';
import { buildPredictionsCsv, serializeModel } from '@/features/ml/train/serialize';
import { runTraining, type TrainArtifacts } from '@/features/ml/train/trainer';
import type { Cell } from '@/features/ml/data/types';

const N = 120;
const data: Record<string, Cell[]> = {
  f1: Array.from({ length: N }, (_, i) => String(i)),
  group: Array.from({ length: N }, (_, i) => (i % 2 === 0 ? 'u' : 'v')),
  label: Array.from({ length: N }, (_, i) => (i < N / 2 ? 'no' : 'yes')),
};
const META = { target: 'label', datasetName: 'demo.csv', rowCount: N };

async function train(
  source: Record<string, Cell[]>,
  target: string,
  features: string[],
): Promise<TrainArtifacts> {
  const columns = new Map(Object.entries(source));
  const profiles = Object.entries(source).map(([name, values]) => profileColumn(name, values));
  const outcome = await runTraining(
    columns,
    profiles,
    { target, features, seed: 42, testRatio: 0.2 },
    { onModelStart: () => undefined, onModelResult: () => undefined, isCancelled: () => false },
  );
  return outcome!.artifacts;
}

const artifacts = () => train(data, 'label', ['f1', 'group']);

describe('serializeModel (format v2)', () => {
  it('exports a manifest with target, pipeline and honest reference metrics', async () => {
    const arts = await artifacts();
    for (const key of [
      'baseline',
      'logistic',
      'naiveBayes',
      'tree',
      'forest',
      'gbdt',
      'mlp',
    ] as const) {
      const json = serializeModel(arts, key, META);
      expect(json, key).not.toBeNull();
      const parsed = JSON.parse(json!);
      expect(parsed.app).toBe('LabML');
      expect(parsed.formatVersion).toBe(2);
      expect(parsed.model).toBe(key);
      expect(parsed.target).toBe('label');
      expect(parsed.classes).toEqual(['no', 'yes']);
      expect(parsed.sourceDataset).toEqual({ name: 'demo.csv', rowCount: N });
      expect(parsed.testMetrics.accuracy).toBeGreaterThan(0);
      expect(parsed.pipeline.specs).toHaveLength(2);
      expect(parsed.featureNames.length).toBeGreaterThan(0);
    }
  });

  it('refuses to export k-NN (it would embed the training data)', async () => {
    expect(serializeModel(await artifacts(), 'knn', META)).toBeNull();
  });
});

describe('deserializeModel — the exported model comes back (v22)', () => {
  const header = ['f1', 'group', 'label'];
  const rawColumns = () => header.map((name) => data[name]);

  it('rebuilds every exportable classifier with identical predictions', async () => {
    const arts = await artifacts();
    for (const key of [
      'baseline',
      'logistic',
      'naiveBayes',
      'tree',
      'forest',
      'gbdt',
      'mlp',
    ] as const) {
      const live = scoreBatch(arts, key, 'label', 'probe.csv', header, rawColumns());
      const imported = deserializeModel(serializeModel(arts, key, META)!);
      expect(imported.manifest.model).toBe(key);
      expect(imported.manifest.featureColumns).toEqual(['f1', 'group']);
      const rebuilt = scoreRows(
        {
          model: imported.model,
          specs: imported.specs,
          transformRow: imported.transformRow,
          classes: imported.manifest.classes,
          isClassification: imported.manifest.isClassification,
        },
        key,
        imported.manifest.testMetrics,
        imported.manifest.target,
        'probe.csv',
        header,
        rawColumns(),
      );
      // Identical rows, labels AND probabilities — the round-trip is exact.
      expect(rebuilt.csv, key).toBe(live.csv);
      expect(rebuilt.metrics, key).toEqual(live.metrics);
    }
  });

  it('rebuilds regressors too (linear, gbdt, mlp, tree, forest)', async () => {
    const regression: Record<string, Cell[]> = {
      x1: Array.from({ length: N }, (_, i) => String(i)),
      x2: Array.from({ length: N }, (_, i) => String((i * 7) % 23)),
      y: Array.from({ length: N }, (_, i) => String(2 * i + ((i * 7) % 23))),
    };
    const arts = await train(regression, 'y', ['x1', 'x2']);
    const regressionHeader = ['x1', 'x2', 'y'];
    const cols = () => regressionHeader.map((name) => regression[name]);
    for (const key of ['baseline', 'linear', 'tree', 'forest', 'gbdt', 'mlp'] as const) {
      const meta = { target: 'y', datasetName: 'reg.csv', rowCount: N };
      const live = scoreBatch(arts, key, 'y', 'probe.csv', regressionHeader, cols());
      const imported = deserializeModel(serializeModel(arts, key, meta)!);
      const rebuilt = scoreRows(
        {
          model: imported.model,
          specs: imported.specs,
          transformRow: imported.transformRow,
          classes: imported.manifest.classes,
          isClassification: imported.manifest.isClassification,
        },
        key,
        imported.manifest.testMetrics,
        'y',
        'probe.csv',
        regressionHeader,
        cols(),
      );
      expect(rebuilt.csv, key).toBe(live.csv);
    }
  });

  it('names every refusal instead of half-loading', async () => {
    expect(() => deserializeModel('not json')).toThrow('invalid-json');
    expect(() => deserializeModel('{"app":"other"}')).toThrow('not-labml');
    expect(() => deserializeModel('{"app":"LabML","formatVersion":1}')).toThrow(
      'unsupported-version:1',
    );
    expect(() => deserializeModel('{"app":"LabML","formatVersion":2,"model":"gbdt"}')).toThrow(
      'bad-manifest',
    );
    const valid = JSON.parse(serializeModel(await artifacts(), 'logistic', META)!);
    valid.parameters.kind = 'quantum';
    expect(() => deserializeModel(JSON.stringify(valid))).toThrow('unsupported-kind:quantum');
  });
});

describe('buildPredictionsCsv', () => {
  it('emits one line per test row with class probabilities', async () => {
    const arts = await artifacts();
    const csv = buildPredictionsCsv(arts, 'logistic');
    const lines = csv.split('\n');
    expect(lines[0]).toBe('actual,predicted,p_no,p_yes');
    expect(lines).toHaveLength(arts.testY.length + 1);
    expect(lines[1].split(',')).toHaveLength(4);
  });
});

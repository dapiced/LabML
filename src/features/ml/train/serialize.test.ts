import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import { deserializeModel } from '@/features/ml/train/deserialize';
import { scoreBatch, scoreRows } from '@/features/ml/train/score';
import { buildPredictionsCsv, referenceOf, serializeModel } from '@/features/ml/train/serialize';
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

describe('serializeModel (format v5)', () => {
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
      expect(parsed.formatVersion).toBe(5);
      expect(parsed.model).toBe(key);
      expect(parsed.target).toBe('label');
      expect(parsed.classes).toEqual(['no', 'yes']);
      expect(parsed.sourceDataset).toEqual({ name: 'demo.csv', rowCount: N });
      expect(parsed.testMetrics.accuracy).toBeGreaterThan(0);
      expect(parsed.pipeline.specs).toHaveLength(2);
      expect(parsed.featureNames.length).toBeGreaterThan(0);
    }
  });

  it('round-trips a multiclass decision policy', async () => {
    const multiclass = {
      ...data,
      label: Array.from({ length: N }, (_, i) => (i < 40 ? 'a' : i < 80 ? 'b' : 'c')),
    };
    const arts = await train(multiclass, 'label', ['f1', 'group']);
    const policy = { thresholds: [0.2, 0.4, 0.6] };
    const imported = deserializeModel(serializeModel(arts, 'logistic', META, policy)!);
    expect(imported.manifest.decisionPolicy).toEqual(policy);
  });

  it('refuses to export k-NN (it would embed the training data)', async () => {
    expect(serializeModel(await artifacts(), 'knn', META)).toBeNull();
  });
});

describe('deserializeModel — the exported model comes back (v22)', () => {
  const header = ['f1', 'group', 'label'];
  const rawColumns = () => header.map((name) => data[name]);

  it('still imports a v2 file, so earlier exports keep working', async () => {
    const arts = await artifacts();
    const v3 = JSON.parse(serializeModel(arts, 'logistic', META)!) as Record<string, unknown>;
    // A v2 file is a v3 file without text specs: only the stamp differs here.
    const v2 = JSON.stringify({ ...v3, formatVersion: 2 });
    const imported = deserializeModel(v2);
    expect(imported.manifest.model).toBe('logistic');
    expect(imported.manifest.featureColumns).toEqual(['f1', 'group']);
  });

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

describe('V61: the production reference travels in the export', () => {
  const header = ['f1', 'group', 'label'];
  const columns = () => new Map(Object.entries(data));

  it('profiles the training rows only, and reads the answers on held-out rows', async () => {
    const arts = await artifacts();
    const reference = referenceOf(arts, 'logistic', columns())!;
    expect(reference.rows).toBe(arts.trainIndices!.length);
    expect(reference.columns.map((column) => column.column)).toEqual(['f1', 'group']);
    expect(reference.predictions.rows).toBe(arts.validationX.length + arts.testX.length);
    expect(reference.performance.rows).toBe(arts.testY.length);
    // The target is not a column the model reads: it has no profile.
    expect(reference.columns.some((column) => column.column === 'label')).toBe(false);
  });

  it('comes back from the file as it went in', async () => {
    const arts = await artifacts();
    const reference = referenceOf(arts, 'logistic', columns());
    const text = serializeModel(arts, 'logistic', META, undefined, reference)!;
    const imported = deserializeModel(text);
    expect(imported.manifest.reference).toEqual(reference);
    expect(imported.manifest.referenceRejected).toBeUndefined();
  });

  it('loads a model whose reference is damaged, without the reference', async () => {
    const arts = await artifacts();
    const file = JSON.parse(
      serializeModel(arts, 'logistic', META, undefined, referenceOf(arts, 'logistic', columns()))!,
    ) as { reference: { predictions: unknown } };
    file.reference.predictions = 'gone';
    const imported = deserializeModel(JSON.stringify(file));
    expect(imported.manifest.model).toBe('logistic');
    expect(imported.manifest.reference).toBeUndefined();
    expect(imported.manifest.referenceRejected).toBe(true);
  });

  it('loads a v4 file as before, with no reference and nothing rejected', async () => {
    const arts = await artifacts();
    const v4 = JSON.stringify({
      ...(JSON.parse(serializeModel(arts, 'logistic', META)!) as Record<string, unknown>),
      formatVersion: 4,
    });
    const imported = deserializeModel(v4);
    expect(imported.manifest.reference).toBeUndefined();
    expect(imported.manifest.referenceRejected).toBeUndefined();
  });

  it('has no reference to give for artifacts that do not say which rows trained', async () => {
    const { trainIndices: _dropped, ...arts } = await artifacts();
    void _dropped;
    expect(referenceOf(arts, 'logistic', columns())).toBeNull();
  });

  it('reads the very rows it was built on as stable, from a live run and from the file', async () => {
    const arts = await artifacts();
    const reference = referenceOf(arts, 'logistic', columns());
    const rawColumns = header.map((name) => data[name]);
    const live = scoreBatch(arts, 'logistic', 'label', 'same.csv', header, rawColumns, undefined, {
      reference,
      testRows: arts.testY.length,
    });
    expect(live.check).toMatchObject({ verdict: 'stable', hasReference: true, driftedColumns: 0 });

    const imported = deserializeModel(
      serializeModel(arts, 'logistic', META, undefined, reference)!,
    );
    const fromFile = scoreRows(
      {
        model: imported.model,
        specs: imported.specs,
        transformRow: imported.transformRow,
        classes: imported.manifest.classes,
        isClassification: true,
      },
      'logistic',
      imported.manifest.testMetrics,
      'label',
      'same.csv',
      header,
      rawColumns,
      { reference: imported.manifest.reference ?? null, testRows: imported.manifest.testRows },
    );
    expect(fromFile.check).toEqual(live.check);
  });

  it('says « watch » on a batch whose column moved, and names the column', async () => {
    const arts = await artifacts();
    const reference = referenceOf(arts, 'logistic', columns());
    // Only the upper half of f1, and no label: the inputs moved, nothing says more.
    const rows = Array.from({ length: N }, (_, i) => i).filter((i) => i >= 80);
    const batchHeader = ['f1', 'group'];
    const batch = batchHeader.map((name) => rows.map((i) => data[name][i]));
    const score = scoreBatch(arts, 'logistic', 'label', 'late.csv', batchHeader, batch, undefined, {
      reference,
      testRows: arts.testY.length,
    });
    expect(score.check?.verdict).toBe('watch');
    expect(score.check?.columns[0]).toMatchObject({ column: 'f1', drifted: true });
    expect(score.check?.performance).toEqual({ status: 'no-labels' });
  });

  it('checks an export with no reference on its labels alone', async () => {
    const arts = await artifacts();
    const rawColumns = header.map((name) => data[name]);
    const score = scoreBatch(arts, 'logistic', 'label', 'same.csv', header, rawColumns);
    expect(score.check).toMatchObject({ hasReference: false, columns: [], predictions: null });
    expect(score.check?.performance.status).toBe('measured');
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

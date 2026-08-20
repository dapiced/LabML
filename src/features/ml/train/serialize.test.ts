import { describe, expect, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import { buildPredictionsCsv, serializeModel } from '@/features/ml/train/serialize';
import { runTraining, type TrainArtifacts } from '@/features/ml/train/trainer';
import type { Cell } from '@/features/ml/data/types';

const N = 120;
const data: Record<string, Cell[]> = {
  f1: Array.from({ length: N }, (_, i) => String(i)),
  group: Array.from({ length: N }, (_, i) => (i % 2 === 0 ? 'u' : 'v')),
  label: Array.from({ length: N }, (_, i) => (i < N / 2 ? 'no' : 'yes')),
};

async function artifacts(): Promise<TrainArtifacts> {
  const columns = new Map(Object.entries(data));
  const profiles = Object.entries(data).map(([name, values]) => profileColumn(name, values));
  const outcome = await runTraining(
    columns,
    profiles,
    { target: 'label', features: ['f1', 'group'], seed: 42, testRatio: 0.2 },
    { onModelStart: () => undefined, onModelResult: () => undefined, isCancelled: () => false },
  );
  return outcome!.artifacts;
}

describe('serializeModel', () => {
  it('exports self-describing parameters for parametric models', async () => {
    const arts = await artifacts();
    for (const key of ['baseline', 'logistic', 'naiveBayes', 'tree', 'forest'] as const) {
      const json = serializeModel(arts, key);
      expect(json, key).not.toBeNull();
      const parsed = JSON.parse(json!);
      expect(parsed.app).toBe('LabML');
      expect(parsed.model).toBe(key);
      expect(parsed.classes).toEqual(['no', 'yes']);
      expect(parsed.featureNames.length).toBeGreaterThan(0);
      expect(parsed.parameters.kind).toBe(
        key === 'tree' || key === 'forest' ? key : parsed.parameters.kind,
      );
    }
  });

  it('refuses to export k-NN (it would embed the training data)', async () => {
    expect(serializeModel(await artifacts(), 'knn')).toBeNull();
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

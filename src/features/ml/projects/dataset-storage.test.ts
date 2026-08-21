import { describe, expect, it } from 'vitest';
import {
  DATASET_QUOTA_BYTES,
  fitsQuota,
  packDataset,
  unpackDataset,
} from '@/features/ml/projects/dataset-storage';

const CSV = 'a,b,c\n1,latte ,\n2,"x,y",é\n3,,0\n';

describe('dataset storage', () => {
  it('round-trips the CSV byte for byte, quotes and accents included', () => {
    const packed = packDataset(CSV);
    expect(unpackDataset(packed.csv)).toBe(CSV);
    expect(packed.originalBytes).toBe(CSV.length * 2);
    expect(packed.storedBytes).toBeGreaterThan(0);
  });

  it('actually compresses repetitive data', () => {
    const repetitive = 'sepal_length,species\n' + '5.1,setosa\n'.repeat(2000);
    const packed = packDataset(repetitive);
    expect(packed.storedBytes).toBeLessThan(packed.originalBytes / 4);
  });

  it('refuses over quota and accepts at the boundary — never silently', () => {
    expect(fitsQuota(0, DATASET_QUOTA_BYTES)).toBe(true);
    expect(fitsQuota(0, DATASET_QUOTA_BYTES + 1)).toBe(false);
    expect(fitsQuota(DATASET_QUOTA_BYTES - 10, 10)).toBe(true);
    expect(fitsQuota(DATASET_QUOTA_BYTES - 10, 11)).toBe(false);
  });

  it('reports corruption as null, not as an empty dataset', () => {
    expect(unpackDataset('')).toBeNull();
  });
});

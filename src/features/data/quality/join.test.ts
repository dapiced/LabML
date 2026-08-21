import { describe, expect, it } from 'vitest';
import { joinDatasets } from './join';
import type { Cell } from '@/features/ml/data/types';

const MAIN_HEADER = ['id', 'product', 'qty'];
const MAIN: Cell[][] = [
  ['1', '2', '3', '4'],
  ['Latte', ' latte ', 'Tea', 'LATTE'],
  ['2', '1', '3', '1'],
];
const RIGHT_HEADER = ['product', 'category', 'qty'];
const RIGHT: Cell[][] = [
  ['Latte', 'Tea', 'Espresso'],
  ['hot', 'hot', 'hot'],
  ['99', '98', '97'],
];

describe('joinDatasets', () => {
  it('left-joins on the trimmed key and reports honest stats', () => {
    const { header, columns, stats } = joinDatasets(
      MAIN_HEADER,
      MAIN,
      RIGHT_HEADER,
      RIGHT,
      'product',
      'products.csv',
    );
    // The right qty collides with the main qty → renamed qty_2.
    expect(header).toEqual(['id', 'product', 'qty', 'category', 'qty_2']);
    // 'Latte' and 'Tea' match; ' latte ' and 'LATTE' do not — trimming only,
    // no case folding: a messy key is a finding, not something to hide.
    expect(columns[3]).toEqual(['hot', null, 'hot', null]);
    expect(columns[4]).toEqual(['99', null, '98', null]);
    expect(stats.matchedRows).toBe(2);
    expect(stats.orphanRows).toBe(2);
    expect(stats.orphanKeys).toEqual(['LATTE', 'latte']);
    expect(stats.unusedRightRows).toBe(1);
    expect(stats.addedColumns).toEqual(['category', 'qty_2']);
    // The main columns are untouched.
    expect(columns[1]).toEqual(MAIN[1]);
  });

  it('counts duplicate right keys and lets the first occurrence win', () => {
    const { columns, stats } = joinDatasets(
      ['k'],
      [['a']],
      ['k', 'v'],
      [
        ['a', 'a'],
        ['first', 'second'],
      ],
      'k',
      'dup.csv',
    );
    expect(stats.duplicateKeys).toBe(1);
    expect(columns[1]).toEqual(['first']);
  });

  it('never matches missing keys', () => {
    const { stats } = joinDatasets(
      ['k'],
      [[null, 'NA', 'a']],
      ['k', 'v'],
      [
        ['a', ''],
        ['x', 'y'],
      ],
      'k',
      'na.csv',
    );
    expect(stats.matchedRows).toBe(1);
    expect(stats.orphanRows).toBe(2);
    // Missing main keys are orphans but not listed as key values.
    expect(stats.orphanKeys).toEqual([]);
  });

  it('throws when the key is absent from either side', () => {
    expect(() => joinDatasets(['a'], [[]], ['b'], [[]], 'a', 'x')).toThrow('join-key-missing');
  });
});

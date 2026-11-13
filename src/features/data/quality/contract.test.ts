import { describe, expect, it } from 'vitest';
import {
  buildContract,
  checkContract,
  CONTRACT_FORMAT,
  parseContract,
  readingOf,
  type Clause,
  type DataContract,
} from '@/features/data/quality/contract';
import { checkValidity } from '@/features/data/quality/validity';
import { mulberry32 } from '@/features/ml/train/random';
import type { Cell } from '@/features/ml/data/types';

// V63: a contract requires of the next file what was found on the reference.
// These tests freeze what breaks a clause, what only warns, and what the
// quality report's own rules would have let through.

const NOW = new Date('2026-06-01T00:00:00Z');
const HEADER = ['age', 'city', 'amount', 'date'];

/** A clean file: ages, three cities, positive amounts, past dates. */
function rows(count: number, seed: number, cities = ['Lyon', 'Paris', 'Nice']): Cell[][] {
  const rng = mulberry32(seed);
  const age: Cell[] = [];
  const city: Cell[] = [];
  const amount: Cell[] = [];
  const date: Cell[] = [];
  for (let i = 0; i < count; i++) {
    age.push(String(18 + Math.floor(rng() * 60)));
    city.push(cities[Math.floor(rng() * cities.length)]);
    amount.push(((rng() + rng()) * 50).toFixed(2));
    date.push(`2025-${String(1 + Math.floor(rng() * 12)).padStart(2, '0')}-15`);
  }
  return [age, city, amount, date];
}

const reference = () => buildContract(HEADER, rows(300, 1), 'ref.csv', NOW);
const check = (contract: DataContract, columns: Cell[][], header = HEADER) =>
  checkContract(contract, header, columns, NOW.getTime());
const open = (clauses: Clause[]) => clauses.filter((clause) => clause.outcome !== 'kept');

/** Replaces a share of one column's cells, the first ones, with a value. */
function spoil(columns: Cell[][], at: number, share: number, value: string): Cell[][] {
  const count = Math.round(columns[at].length * share);
  return columns.map((cells, j) =>
    j === at ? cells.map((c, r) => (r < count ? value : c)) : cells,
  );
}

describe('buildContract', () => {
  const contract = reference();

  it('freezes columns, how they read, and the rules that applied', () => {
    expect(contract.format).toBe(CONTRACT_FORMAT);
    expect(contract.rowCount).toBe(300);
    expect(contract.columns.map((column) => [column.name, column.reading])).toEqual([
      ['age', 'number'],
      ['city', 'words'],
      ['amount', 'number'],
      ['date', 'date'],
    ]);
    expect(contract.rules.map((rule) => [rule.rule, rule.columns, rule.failures])).toEqual([
      ['ageRange', ['age'], 0],
      ['negativeAmount', ['amount'], 0],
      ['futureDate', ['date'], 0],
    ]);
    expect(contract.rules[0]).toMatchObject({ bound: { min: 0, max: 120 }, tested: 300 });
  });

  it('profiles a distribution only where one means something', () => {
    const profiled = contract.columns.filter((column) => column.profile).map((c) => c.name);
    // A date has no bins here: every new file's dates « drift ».
    expect(profiled).toEqual(['age', 'city', 'amount']);
  });

  it('holds no cell of any row', () => {
    const text = JSON.stringify(contract);
    const [, , amount, date] = rows(300, 1);
    expect(amount.filter((cell) => text.includes(`"${cell as string}"`))).toEqual([]);
    expect(date.filter((cell) => text.includes(cell as string))).toEqual([]);
  });
});

describe('checkContract: the file it was drawn from, and one like it', () => {
  it('keeps every clause on the reference itself', () => {
    const result = check(reference(), rows(300, 1));
    expect(result.verdict).toBe('kept');
    expect(result.counts.broken + result.counts.warning).toBe(0);
    // Two schema clauses and one missing clause per column, three rules, three distributions.
    expect(result.counts.kept).toBe(4 * 3 + 3 + 3);
  });

  it('holds its rate on files that did not change', () => {
    const contract = reference();
    let broken = 0;
    const CHECKS = 40;
    for (let seed = 0; seed < CHECKS; seed++) {
      if (check(contract, rows(200, 100 + seed)).verdict === 'broken') broken += 1;
    }
    // Facts cannot break on a clean file, and the estimates share a 5 % level.
    expect(broken / CHECKS).toBeLessThanOrEqual(0.1);
  }, 60_000);
});

describe('checkContract: facts break a clause outright', () => {
  const contract = reference();

  it('says a column is absent, and reads the others all the same', () => {
    const [age, , amount, date] = rows(200, 2);
    const result = check(contract, [age, amount, date], ['age', 'amount', 'date']);
    expect(result.verdict).toBe('broken');
    expect(open(result.clauses)).toEqual([
      { family: 'schema', kind: 'present', column: 'city', outcome: 'broken' },
    ]);
  });

  it('says values no longer read as numbers', () => {
    const result = check(contract, spoil(rows(200, 3), 0, 0.6, 'unknown'));
    const clause = open(result.clauses).find((c) => c.family === 'schema' && c.kind === 'reading');
    expect(clause).toMatchObject({ column: 'age', expected: 'number', found: 'words' });
    expect(result.verdict).toBe('broken');
  });

  it('breaks on the first impossible value of a rule that was clean', () => {
    const result = check(contract, spoil(rows(200, 4), 0, 0.005, '200'));
    const clause = open(result.clauses).find((c) => c.family === 'rule');
    expect(clause).toMatchObject({
      rule: 'ageRange',
      columns: ['age'],
      failures: 1,
      tested: 200,
      referenceFailures: 0,
      rows: [0],
      examples: ['200'],
      outcome: 'broken',
    });
  });

  it('speaks where the quality report falls silent: a third of the ages impossible', () => {
    const spoiled = spoil(rows(200, 5), 0, 0.3, '999');
    // The report's own rule no longer considers itself applicable.
    expect(checkValidity(HEADER, spoiled, NOW.getTime()).filter((f) => f.column === 'age')).toEqual(
      [],
    );
    const clause = open(check(contract, spoiled).clauses).find((c) => c.family === 'rule');
    expect(clause).toMatchObject({
      rule: 'ageRange',
      failures: 60,
      tested: 200,
      outcome: 'broken',
    });
  });

  it('lists at most ten failing rows, and counts them all', () => {
    const clause = open(check(contract, spoil(rows(200, 6), 2, 0.25, '-3')).clauses).find(
      (c) => c.family === 'rule',
    );
    expect(clause).toMatchObject({ rule: 'negativeAmount', failures: 50 });
    if (clause?.family === 'rule') expect(clause.rows).toHaveLength(10);
  });

  it('warns, without claiming a failure, when a rule finds nothing it can read', () => {
    const result = check(contract, spoil(rows(200, 7), 3, 1, 'someday'));
    const clause = result.clauses.find((c) => c.family === 'rule' && c.rule === 'futureDate');
    expect(clause).toMatchObject({ tested: 0, unreadable: true, outcome: 'warning' });
  });
});

describe('checkContract: a rule that already failed at the reference', () => {
  // Three negative amounts in three hundred rows, known and accepted.
  const dirty = buildContract(HEADER, spoil(rows(300, 1), 2, 0.01, '-1'), 'ref.csv', NOW);

  it('is not broken by the same rate', () => {
    expect(dirty.rules.find((rule) => rule.rule === 'negativeAmount')?.failures).toBe(3);
    const result = check(dirty, spoil(rows(200, 8), 2, 0.01, '-1'));
    expect(
      result.clauses.find((c) => c.family === 'rule' && c.rule === 'negativeAmount'),
    ).toMatchObject({ failures: 2, outcome: 'kept' });
  });

  it('is broken by a rate measurably higher', () => {
    const result = check(dirty, spoil(rows(200, 9), 2, 0.2, '-1'));
    expect(
      result.clauses.find((c) => c.family === 'rule' && c.rule === 'negativeAmount'),
    ).toMatchObject({ failures: 40, outcome: 'broken' });
  });
});

describe('checkContract: estimates count only beyond their noise', () => {
  const contract = reference();

  it('keeps a handful of missing values, and breaks on a real rise', () => {
    const few = check(contract, spoil(rows(200, 10), 1, 0.01, ''));
    expect(few.clauses.find((c) => c.family === 'missing' && c.column === 'city')).toMatchObject({
      outcome: 'kept',
    });
    const many = check(contract, spoil(rows(200, 11), 1, 0.2, ''));
    const clause = many.clauses.find((c) => c.family === 'missing' && c.column === 'city');
    expect(clause).toMatchObject({ reference: 0, found: 0.2, outcome: 'broken' });
    if (clause?.family === 'missing') expect(clause.lo).toBeGreaterThan(0);
  });

  it('never breaks on fewer missing values than the reference had', () => {
    const holey = buildContract(HEADER, spoil(rows(300, 1), 1, 0.3, ''), 'ref.csv', NOW);
    const result = check(holey, rows(200, 12));
    expect(result.clauses.find((c) => c.family === 'missing' && c.column === 'city')).toMatchObject(
      {
        outcome: 'kept',
      },
    );
  });

  it('warns, and does not break, when a distribution moved', () => {
    const older = rows(200, 13).map((cells, j) =>
      j === 0 ? cells.map((cell) => String(Number(cell) + 25)) : cells,
    );
    const result = check(contract, older);
    expect(open(result.clauses)).toEqual([
      expect.objectContaining({ family: 'distribution', column: 'age', outcome: 'warning' }),
    ]);
    expect(result.verdict).toBe('warning');
  });

  it('notes a column the contract does not describe, without breaking', () => {
    const columns = rows(200, 14);
    const result = check(contract, [...columns, columns[0]], [...HEADER, 'loyalty']);
    expect(result.extraColumns).toEqual(['loyalty']);
    expect(result.counts.broken).toBe(0);
  });
});

describe('readingOf', () => {
  it('does not depend on how varied the values are', () => {
    // The inferred type would call one of these an identifier and the other a number.
    expect(readingOf('order_id', ['1001', '1002', '1003', '1004'])).toBe('number');
    expect(readingOf('order_id', ['1001', '1001', '1003', '1004'])).toBe('number');
    // And one of these categorical, the other free text.
    expect(readingOf('notes', ['ok', 'ok', 'ok'])).toBe('words');
    expect(readingOf('notes', ['late delivery', 'client called', 'refund'])).toBe('words');
    expect(readingOf('day', ['2025-01-02', '2025-03-04'])).toBe('date');
    expect(readingOf('x', ['', '  '])).toBe('empty');
  });

  it('lets an empty column pass the reading clause: the missing clause speaks for it', () => {
    const result = check(reference(), spoil(rows(200, 15), 0, 1, ''));
    expect(
      result.clauses.find(
        (c) => c.family === 'schema' && c.kind === 'reading' && c.column === 'age',
      ),
    ).toMatchObject({ found: 'empty', outcome: 'kept' });
    expect(result.clauses.find((c) => c.family === 'missing' && c.column === 'age')).toMatchObject({
      found: 1,
      outcome: 'broken',
    });
  });
});

describe('parseContract', () => {
  const contract = reference();

  it('reads back what was written', () => {
    expect(parseContract(JSON.stringify(contract))).toEqual(contract);
  });

  it('refuses whole anything that is not a whole contract', () => {
    const copy = () => JSON.parse(JSON.stringify(contract)) as Record<string, unknown>;
    const broken: unknown[] = ['not json at all', { ...copy(), format: 'labml-data-profile/1' }];
    broken.push({ ...copy(), columns: [] });
    broken.push({ ...copy(), rowCount: -1 });
    broken.push({ ...copy(), rules: 'none' });
    const badReading = copy();
    (badReading.columns as { reading: string }[])[0].reading = 'music';
    broken.push(badReading);
    const unknownRule = copy();
    (unknownRule.rules as { rule: string }[])[0].rule = 'mustBePrime';
    broken.push(unknownRule);
    const strayColumn = copy();
    (strayColumn.rules as { columns: string[] }[])[0].columns = ['elsewhere'];
    broken.push(strayColumn);
    const moreFailures = copy();
    (moreFailures.rules as { failures: number }[])[0].failures = 9999;
    broken.push(moreFailures);
    const badProfile = copy();
    (badProfile.columns as { profile: unknown }[])[0].profile = { kind: 'numeric' };
    broken.push(badProfile);
    for (const candidate of broken) {
      expect(
        parseContract(typeof candidate === 'string' ? candidate : JSON.stringify(candidate)),
      ).toBeNull();
    }
  });
});

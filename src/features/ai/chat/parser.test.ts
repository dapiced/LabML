import { describe, expect, it } from 'vitest';
import { fold, parseQuestion, type ColumnInfo } from './parser';

const columns: ColumnInfo[] = [
  { name: 'pclass', isNumeric: true, values: [] },
  { name: 'class', isNumeric: false, values: ['First', 'Second', 'Third'] },
  { name: 'sex', isNumeric: false, values: ['male', 'female'] },
  { name: 'age', isNumeric: true, values: [] },
  { name: 'fare', isNumeric: true, values: [] },
  { name: 'embark_town', isNumeric: false, values: ['Southampton', 'Cherbourg', 'Queenstown'] },
];

describe('fold', () => {
  it('strips accents, case and separators', () => {
    expect(fold('Écart-type de l’ÂGE')).toBe('ecart-type de l age');
    expect(fold('embark_town')).toBe('embark town');
  });
});

describe('parseQuestion — English', () => {
  it('parses a plain aggregate', () => {
    expect(parseQuestion('What is the average age?', columns, 'en')).toEqual({
      kind: 'aggregate',
      op: 'mean',
      column: 'age',
      groupBy: undefined,
      filter: undefined,
    });
  });

  it('parses aggregate + group-by', () => {
    expect(parseQuestion('average age by class', columns, 'en')).toMatchObject({
      kind: 'aggregate',
      op: 'mean',
      column: 'age',
      groupBy: 'class',
    });
  });

  it('parses a numeric filter with a verbal comparator', () => {
    expect(parseQuestion('median fare where age is greater than 30', columns, 'en')).toMatchObject({
      kind: 'aggregate',
      op: 'median',
      column: 'fare',
      filter: { column: 'age', op: '>', value: 30 },
    });
  });

  it('parses count with a categorical filter through a late "is"', () => {
    expect(parseQuestion('How many rows where sex is female?', columns, 'en')).toMatchObject({
      kind: 'count',
      filter: { column: 'sex', op: '=', value: 'female' },
    });
  });

  it('parses a bare category value as an equality filter', () => {
    expect(parseQuestion('average fare for female', columns, 'en')).toMatchObject({
      kind: 'aggregate',
      op: 'mean',
      column: 'fare',
      filter: { column: 'sex', op: '=', value: 'female' },
    });
  });

  it('parses top-k with an explicit metric', () => {
    expect(parseQuestion('top 2 embark_town by average fare', columns, 'en')).toMatchObject({
      kind: 'topk',
      groupBy: 'embark_town',
      k: 2,
      op: 'mean',
      column: 'fare',
    });
  });

  it('parses correlation between two columns', () => {
    expect(parseQuestion('correlation between age and fare', columns, 'en')).toEqual({
      kind: 'correlation',
      a: 'age',
      b: 'fare',
    });
  });

  it('prefers the longest column mention (class vs pclass)', () => {
    expect(parseQuestion('average age by pclass', columns, 'en')).toMatchObject({
      groupBy: 'pclass',
    });
  });

  it('maps count + group-by to a full ranking', () => {
    expect(parseQuestion('how many passengers per class', columns, 'en')).toMatchObject({
      kind: 'topk',
      groupBy: 'class',
      op: 'count',
    });
  });

  it('returns null on something it cannot honestly answer', () => {
    expect(parseQuestion('tell me a joke about boats', columns, 'en')).toBeNull();
  });
});

describe('parseQuestion — français', () => {
  it('comprend une moyenne filtrée avec accents', () => {
    expect(parseQuestion('moyenne de fare où âge supérieur à 30', columns, 'fr')).toMatchObject({
      kind: 'aggregate',
      op: 'mean',
      column: 'fare',
      filter: { column: 'age', op: '>', value: 30 },
    });
  });

  it('comprend « combien » avec égalité catégorielle via « est »', () => {
    expect(parseQuestion('combien de lignes où sex est female ?', columns, 'fr')).toMatchObject({
      kind: 'count',
      filter: { column: 'sex', op: '=', value: 'female' },
    });
  });

  it('comprend un group-by avec « par »', () => {
    expect(parseQuestion('quelle est la moyenne de age par class ?', columns, 'fr')).toMatchObject({
      kind: 'aggregate',
      op: 'mean',
      column: 'age',
      groupBy: 'class',
    });
  });

  it('comprend un top avec métrique', () => {
    expect(parseQuestion('top 3 des embark_town par somme de fare', columns, 'fr')).toMatchObject({
      kind: 'topk',
      groupBy: 'embark_town',
      k: 3,
      op: 'sum',
      column: 'fare',
    });
  });

  it('comprend la répartition et les manquants', () => {
    expect(parseQuestion('répartition de class', columns, 'fr')).toEqual({
      kind: 'distribution',
      column: 'class',
    });
    expect(parseQuestion('combien de valeurs manquantes ?', columns, 'fr')).toEqual({
      kind: 'missing',
    });
  });

  it('comprend l’écart-type', () => {
    expect(parseQuestion("l'écart-type de fare", columns, 'fr')).toMatchObject({
      kind: 'aggregate',
      op: 'std',
      column: 'fare',
    });
  });

  it('décimales à la française', () => {
    expect(
      parseQuestion('combien de lignes où fare inférieur à 7,25', columns, 'fr'),
    ).toMatchObject({ kind: 'count', filter: { column: 'fare', op: '<', value: 7.25 } });
  });
});

describe('a condition it cannot read is REFUSED, never dropped', () => {
  // Reported from production (V27 testing): "combien d'enfant en bas de 10 ans"
  // answered 891 — the whole table — because the parser kept the count and
  // silently discarded the part it did not understand.
  it('refuses a French question whose numeric condition it cannot map', () => {
    expect(parseQuestion("combien d'enfant en bas de 10 ans ?", columns, 'fr')).toBeNull();
  });

  it('refuses an English question whose numeric condition it cannot map', () => {
    expect(parseQuestion('how many children under 10 years old?', columns, 'en')).toBeNull();
  });

  it('refuses an aggregate whose condition it cannot map at all', () => {
    expect(parseQuestion('average age for kids born before 1900', columns, 'en')).toBeNull();
  });

  // The guard targets DROPPED conditions, not guessed columns. Here the
  // condition IS applied — to `fare`, the only numeric column named — which
  // also happens to be the legitimate reading of "average fare below 12".
  // Refusing this would cost a real question to catch a fuzzy one.
  it('keeps a condition it can attach, even when the wording is loose', () => {
    expect(parseQuestion('average fare for kids below 12', columns, 'en')).toMatchObject({
      kind: 'aggregate',
      op: 'mean',
      column: 'fare',
      filter: { column: 'fare', op: '<', value: 12 },
    });
  });

  it('still answers the same question when the condition names a real column', () => {
    expect(parseQuestion('how many rows where age is under 10?', columns, 'en')).toEqual({
      kind: 'count',
      filter: { column: 'age', op: '<', value: 10 },
    });
  });

  it('leaves conditionless questions alone — no number, no comparator, no refusal', () => {
    expect(parseQuestion('combien de personnes au total ?', columns, 'fr')).toEqual({
      kind: 'count',
      filter: undefined,
    });
    expect(parseQuestion('What is the average age?', columns, 'en')).toMatchObject({
      kind: 'aggregate',
      op: 'mean',
      column: 'age',
    });
  });
});

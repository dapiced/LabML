import { describe, expect, it } from 'vitest';
import { buildSubmission, formsFor, type SubmissionInput } from '@/features/ml/train/submission';

// V65: a submission has the rows of the scored file, in their order, under
// the names the user gave, and counts what a platform would refuse.

function input(over: Partial<SubmissionInput> = {}): SubmissionInput {
  return {
    ids: ['892', '893', '894', '895'],
    idName: 'PassengerId',
    predictionName: 'Survived',
    form: 'label',
    predictions: [0, 1, 1, 0],
    probabilities: [
      [0.9, 0.1],
      [0.25, 0.75],
      [0.4, 0.6],
      [0.8123456789, 0.1876543211],
    ],
    classes: ['no', 'yes'],
    isClassification: true,
    ...over,
  };
}

describe('formsFor', () => {
  it('offers only the forms the task has an object for', () => {
    expect(formsFor(false, 0, false)).toEqual(['value']);
    expect(formsFor(true, 2, true)).toEqual(['label', 'probability']);
    expect(formsFor(true, 3, true)).toEqual(['label', 'probabilities']);
    expect(formsFor(true, 3, false)).toEqual(['label']);
  });
});

describe('buildSubmission', () => {
  it('writes the identifier and the class name, row for row and in order', () => {
    const file = buildSubmission(input());
    expect(file.csv).toBe('PassengerId,Survived\n892,no\n893,yes\n894,yes\n895,no\n');
    expect(file.rows).toBe(4);
    expect(file.header).toEqual(['PassengerId', 'Survived']);
    expect(file.counts).toEqual([
      { label: 'no', count: 2 },
      { label: 'yes', count: 2 },
    ]);
    expect(file.missingIds).toBe(0);
    expect(file.duplicateIds).toBe(0);
  });

  it('writes the probability of the second class, to six decimals', () => {
    const file = buildSubmission(input({ form: 'probability' }));
    expect(file.csv.split('\n').slice(1, 5)).toEqual([
      '892,0.1',
      '893,0.75',
      '894,0.6',
      '895,0.187654',
    ]);
    expect(file.range?.min).toBeCloseTo(0.1);
    expect(file.range?.max).toBeCloseTo(0.75);
    expect(file.counts).toBeUndefined();
  });

  it('writes one column per class in multiclass, named after the classes', () => {
    const file = buildSubmission(
      input({
        form: 'probabilities',
        ids: ['a', 'b'],
        predictions: [2, 0],
        probabilities: [
          [0.1, 0.2, 0.7],
          [0.5, 0.3, 0.2],
        ],
        classes: ['setosa', 'versicolor', 'virginica'],
        predictionName: '',
      }),
    );
    expect(file.csv).toBe(
      'PassengerId,setosa,versicolor,virginica\na,0.1,0.2,0.7\nb,0.5,0.3,0.2\n',
    );
  });

  it('writes the value of a regression untouched', () => {
    const file = buildSubmission(
      input({
        form: 'value',
        isClassification: false,
        classes: [],
        probabilities: null,
        predictions: [23.456789012, 18, 31.5, 20],
        predictionName: 'mpg',
      }),
    );
    expect(file.csv.split('\n')[1]).toBe('892,23.456789012');
    expect(file.range).toEqual({ min: 18, max: 31.5, mean: (23.456789012 + 18 + 31.5 + 20) / 4 });
  });

  it('numbers the rows from 1 when no column identifies them', () => {
    const file = buildSubmission(input({ ids: null, idName: 'id' }));
    expect(file.csv.split('\n').slice(0, 3)).toEqual(['id,Survived', '1,no', '2,yes']);
  });

  it('keeps a row whose identifier is missing or repeated, and counts it', () => {
    const file = buildSubmission(input({ ids: ['892', null, ' 892 ', ''] }));
    expect(file.rows).toBe(4);
    expect(file.csv.split('\n').slice(1, 5)).toEqual(['892,no', ',yes', '892,yes', ',no']);
    expect(file.missingIds).toBe(2);
    expect(file.duplicateIds).toBe(1);
  });

  it('escapes names and values that carry a comma or a quote', () => {
    const file = buildSubmission(
      input({
        ids: ['a,1', 'b"2', 'c', 'd'],
        idName: 'id, of row',
        predictionName: 'the "answer"',
        classes: ['no, never', 'yes'],
      }),
    );
    const lines = file.csv.split('\n');
    expect(lines[0]).toBe('"id, of row","the ""answer"""');
    expect(lines[1]).toBe('"a,1","no, never"');
    expect(lines[2]).toBe('"b""2",yes');
  });

  it('refuses by name what would not make a readable file', () => {
    expect(() => buildSubmission(input({ idName: '  ' }))).toThrow('name-empty');
    expect(() => buildSubmission(input({ predictionName: '' }))).toThrow('name-empty');
    expect(() => buildSubmission(input({ predictionName: ' PassengerId ' }))).toThrow('name-clash');
    expect(() => buildSubmission(input({ form: 'value' }))).toThrow('form-unavailable');
    expect(() => buildSubmission(input({ form: 'probability', probabilities: null }))).toThrow(
      'form-unavailable',
    );
    expect(() => buildSubmission(input({ ids: ['1'] }))).toThrow('rows-mismatch');
    expect(() =>
      buildSubmission(
        input({
          form: 'probabilities',
          classes: ['a', 'PassengerId', 'c'],
          probabilities: [[1, 0, 0]],
          predictions: [0],
          ids: ['1'],
        }),
      ),
    ).toThrow('name-clash');
  });

  it('previews the header and the first lines only', () => {
    const file = buildSubmission(
      input({
        ids: null,
        predictions: Array.from({ length: 30 }, () => 1),
        probabilities: Array.from({ length: 30 }, () => [0.2, 0.8]),
      }),
    );
    expect(file.preview).toHaveLength(5);
    expect(file.preview[0]).toBe('PassengerId,Survived');
  });
});

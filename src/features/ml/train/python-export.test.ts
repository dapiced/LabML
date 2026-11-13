import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildPythonConfig,
  buildPythonScript,
  configText,
  FAMILIES,
  type PythonConfig,
  type PythonExportInput,
} from '@/features/ml/train/python-export';

// V64: the script carries a run exactly where it can, and says where it cannot.
// It is also run here: a script that does not compile fails this suite.

function input(over: Partial<PythonExportInput> = {}): PythonExportInput {
  return {
    appVersion: '1.64.0',
    source: 'titanic.csv',
    rowCount: 12,
    header: ['age', 'sex', 'deck', 'survived'],
    delimiter: ',',
    encoding: 'utf-8',
    decimalColumns: [],
    malformedRows: 0,
    target: 'survived',
    isClassification: true,
    classes: ['0', '1'],
    seed: 42,
    classWeighting: false,
    specs: [
      { kind: 'numeric', name: 'age', median: 28.125, mean: 29.6431, std: 14.1337 },
      { kind: 'onehot', name: 'sex', categories: ['male', 'female'], mode: 'male' },
      {
        kind: 'ordinal',
        name: 'deck',
        ranks: new Map([
          ['C', 0],
          ['B', 1],
          ['E', 2],
        ]),
        mode: 'C',
        mean: 0.8123,
        std: 0.7345,
      },
    ],
    featureCount: 4,
    split: { train: [0, 1, 2, 3, 4, 5, 6], validation: [7, 8], test: [9, 10, 11] },
    models: [
      { key: 'baseline', metrics: { accuracy: 0.618 } },
      { key: 'knn', metrics: { accuracy: 0.792 } },
      { key: 'gbdt', metrics: { accuracy: 0.82, f1: 0.77 } },
      { key: 'ensemble', metrics: { accuracy: 0.83 } },
    ],
    ...over,
  };
}

/**
 * The interpreter on this machine: `python3` on Linux and macOS, `python` on
 * Windows. CI has one, and its absence there is a failure, not a skip: these
 * are the tests that prove the exported script is Python at all. A developer
 * machine without Python sees them reported as skipped.
 */
const PYTHON = ['python3', 'python'].find((command) => {
  try {
    execFileSync(command, ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
});
if (!PYTHON && process.env.CI) throw new Error('No Python interpreter in CI.');

/** Runs the script with the interpreter and returns what it printed. */
function python(script: string, args: string[]): string {
  const directory = mkdtempSync(join(tmpdir(), 'labml-py-'));
  const path = join(directory, 'run.py');
  writeFileSync(path, script);
  execFileSync(PYTHON!, ['-m', 'py_compile', path], { stdio: 'pipe' });
  return execFileSync(PYTHON!, [path, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

/** The configuration as the script itself would read it. */
function readBack(script: string): PythonConfig {
  const start = script.indexOf("r'''\n") + 5;
  const end = script.indexOf("\n''')", start);
  return JSON.parse(script.slice(start, end)) as PythonConfig;
}

describe('buildPythonConfig', () => {
  const config = buildPythonConfig(input());

  it('carries the rows of each split, the columns and how each is encoded', () => {
    expect(config.split).toEqual({
      train: [0, 1, 2, 3, 4, 5, 6],
      validation: [7, 8],
      test: [9, 10, 11],
    });
    expect(config.features).toEqual([
      { name: 'age', kind: 'numeric' },
      { name: 'sex', kind: 'onehot', categories: ['male', 'female'], mode: 'male' },
      // An ordinal column keeps its labels in rank order: the rank is the encoding.
      { name: 'deck', kind: 'ordinal', categories: ['C', 'B', 'E'], mode: 'C' },
    ]);
    expect(config).toMatchObject({
      target: 'survived',
      task: 'classification',
      seed: 42,
      rows: 12,
    });
  });

  it('names the estimator of each family, and how it relates to the lab one', () => {
    expect(config.models.map((model) => [model.key, model.estimator, model.relation])).toEqual([
      ['baseline', 'DummyClassifier', 'same'],
      ['knn', 'KNeighborsClassifier', 'same-ties'],
      ['gbdt', 'HistGradientBoostingClassifier', 'translated'],
    ]);
    expect(config.models[2].lab).toEqual({ accuracy: 0.82, f1: 0.77 });
  });

  it('names what it does not redo instead of dropping it', () => {
    expect(config.not_redone).toEqual(['ensemble']);
  });

  it('picks the regressor of a family on a regression, and has none for the logistic', () => {
    const regression = buildPythonConfig(
      input({
        isClassification: false,
        classes: [],
        models: [
          { key: 'linear', metrics: { rmse: 3.3 } },
          { key: 'forest', metrics: { rmse: 2.6 } },
          { key: 'logistic', metrics: {} },
        ],
      }),
    );
    expect(regression.task).toBe('regression');
    expect(regression.models.map((model) => model.estimator)).toEqual([
      'Ridge',
      'RandomForestRegressor',
    ]);
    expect(regression.not_redone).toEqual(['logistic']);
  });

  it('says what a reader must know before trusting a comparison', () => {
    expect(config.notes).toEqual([]);
    const noted = buildPythonConfig(
      input({
        source: 'sales.xlsx',
        malformedRows: 3,
        classWeighting: true,
        specs: [{ kind: 'text', name: 'review', terms: ['late', 'refund'], idf: [1.2, 1.6] }],
        models: [{ key: 'forest', metrics: { accuracy: 0.8 }, trainedRows: 5 }],
      }),
    );
    expect(noted.notes).toEqual([
      'spreadsheet',
      'malformed-rows',
      'text-columns',
      'sampled-training',
      'class-weighting',
    ]);
    expect(noted.models[0].lab_trained_rows).toBe(5);
    // The vocabulary travels; the weights are refitted by the script.
    expect(noted.features).toEqual([{ name: 'review', kind: 'text', terms: ['late', 'refund'] }]);
  });

  it('does not flag a family fitted on every training row as sampled', () => {
    const whole = buildPythonConfig(
      input({ models: [{ key: 'forest', metrics: { accuracy: 0.8 }, trainedRows: 7 }] }),
    );
    expect(whole.notes).toEqual([]);
    expect(whole.models[0].lab_trained_rows).toBeUndefined();
  });

  it('drops a metric that is not a number rather than writing NaN into the script', () => {
    const odd = buildPythonConfig(
      input({ models: [{ key: 'gbdt', metrics: { accuracy: 0.8, auc: Number.NaN } }] }),
    );
    expect(odd.models[0].lab).toEqual({ accuracy: 0.8 });
  });

  it('has an estimator for every family the lab trains', () => {
    for (const key of [
      'baseline',
      'linear',
      'logistic',
      'knn',
      'naiveBayes',
      'tree',
      'forest',
      'gbdt',
      'mlp',
    ] as const) {
      expect(FAMILIES[key], key).toBeDefined();
    }
  });
});

describe('buildPythonScript', () => {
  it('is the same text for the same run', () => {
    expect(buildPythonScript(input())).toBe(buildPythonScript(input()));
  });

  it('reads back, through json.loads, exactly what the run was', () => {
    const script = buildPythonScript(input());
    expect(readBack(script)).toEqual(buildPythonConfig(input()));
  });

  it('writes each split on one line, not one row per line', () => {
    const text = configText(buildPythonConfig(input()));
    expect(text).toContain('"train": [0,1,2,3,4,5,6]');
    expect(text).toContain('"test": [9,10,11]');
  });

  it('holds no value of any row', () => {
    const script = buildPythonScript(input());
    // The script refits the preprocessing on the training rows: not even the
    // fitted median, mean or deviation of a column travels, let alone a cell.
    for (const fitted of ['28.125', '29.6431', '14.1337', '0.8123', '0.7345']) {
      expect(script).not.toContain(fitted);
    }
  });

  it('keeps a hostile column name a piece of data', () => {
    const hostile = `x'''\n__import__("os").system("touch /tmp/labml-pwned")\nr'''`;
    const script = buildPythonScript(
      input({
        header: [hostile, 'sex', 'deck', 'survived'],
        specs: [{ kind: 'numeric', name: hostile, median: 1, mean: 1, std: 1 }],
        classes: ["it's", 'a "quote"', 'back\\slash'],
      }),
    );
    // No apostrophe survives in the block, so nothing can close the string.
    const block = script.slice(script.indexOf("r'''\n") + 5, script.indexOf("\n''')"));
    expect(block).not.toContain("'");
    const config = readBack(script);
    expect(config.header[0]).toBe(hostile);
    expect(config.classes).toEqual(["it's", 'a "quote"', 'back\\slash']);
  });
});

describe.skipIf(!PYTHON)('the script, run by Python', () => {
  it('reads a hostile column name as a name, and runs none of it', () => {
    const marker = join(tmpdir(), `labml-pwned-${process.pid}`);
    const hostile = `x'''\n__import__("os").system("touch ${marker}")\nr'''`;
    const printed = python(
      buildPythonScript(
        input({
          header: [hostile, 'sex', 'deck', 'survived'],
          specs: [{ kind: 'numeric', name: hostile, median: 1, mean: 1, std: 1 }],
        }),
      ),
      ['--check'],
    );
    expect(printed).toContain('12 rows');
    expect(existsSync(marker)).toBe(false);
  });

  it('compiles, and --check reads the run with no library', () => {
    const printed = python(buildPythonScript(input()), ['--check']);
    expect(printed).toContain("titanic.csv: 12 rows, target 'survived', classification");
    expect(printed).toContain('Split: 7 train, 2 validation, 3 test.');
    expect(printed).toContain('baseline -> DummyClassifier (same algorithm)');
    expect(printed).toContain(
      'knn -> KNeighborsClassifier (same algorithm, equal distances broken differently)',
    );
    expect(printed).toContain(
      'gbdt -> HistGradientBoostingClassifier (same family, another implementation)',
    );
    expect(printed).toContain('ensemble -> not redone by this script');
  });

  it('refuses a run whose splits overlap or leave the file', () => {
    const fails = (over: Partial<PythonExportInput>) => {
      try {
        python(buildPythonScript(input(over)), ['--check']);
        return '';
      } catch (error) {
        return String((error as { stderr?: Buffer }).stderr ?? '');
      }
    };
    expect(fails({ split: { train: [0, 1], validation: [], test: [1, 2] } })).toContain(
      'shares rows with another split',
    );
    expect(fails({ split: { train: [0, 1], validation: [], test: [99] } })).toContain(
      'names a row outside the file',
    );
    expect(fails({ target: 'elsewhere' })).toContain('The target is not a column of the file');
  });
});

/**
 * V64: the bench behind `tests/golden/python-bridge.md`. Skipped unless asked
 * for, like the language-model bench: CI has no scikit-learn, and the figures
 * are a record to regenerate on purpose, not a test to pass.
 *
 *   LABML_BRIDGE_OUT=/tmp/bridge npx vitest run src/features/ml/train/python-bridge.bench.test.ts
 *   python tests/golden/python-bridge.py /tmp/bridge public/datasets
 *
 * For each demo and five seeds it writes the script of the run and the matrix
 * the lab encoded, so the second command can compare both sides.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import Papa from 'papaparse';
import { describe, it } from 'vitest';
import { profileColumn } from '@/features/ml/data/profile';
import { buildPythonScript } from '@/features/ml/train/python-export';
import { runTraining } from '@/features/ml/train/trainer';
import type { ModelResult } from '@/features/ml/train/types';
import type { Cell } from '@/features/ml/data/types';

const OUT = process.env.LABML_BRIDGE_OUT;

/** File, target, and the columns a user would set aside (a leak, a free label). */
const DEMOS: [string, string, string[]][] = [
  ['titanic.csv', 'survived', ['alive']],
  ['fraud.csv', 'status', []],
  ['iris.csv', 'species', []],
  ['reviews.csv', 'satisfied', []],
  ['mpg.csv', 'mpg', ['name']],
  ['energy.csv', 'kwh', []],
];
const SEEDS = [1, 2, 3, 4, 5];

describe.skipIf(!OUT)('python bridge bench (V64)', () => {
  it('writes the script and the encoded matrix of every run', async () => {
    mkdirSync(OUT!, { recursive: true });
    for (const seed of SEEDS) {
      for (const [file, target, setAside] of DEMOS) {
        const text = readFileSync(`public/datasets/${file}`, 'utf8');
        const [header, ...rows] = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true }).data;
        const columns = new Map<string, Cell[]>();
        header.forEach((name, j) =>
          columns.set(
            name,
            rows.map((row) => row[j] ?? ''),
          ),
        );
        const profiles = header.map((name) => profileColumn(name, columns.get(name)!));
        const features = header.filter((name) => name !== target && !setAside.includes(name));
        const results: ModelResult[] = [];
        const run = await runTraining(
          columns,
          profiles,
          { target, features, seed, testRatio: 0.2 },
          {
            onModelStart() {},
            onModelResult: (result) => void results.push(result),
            isCancelled: () => false,
          },
        );
        const arts = run!.artifacts;
        const base = `${OUT}/${file.replace('.csv', '')}-s${seed}`;
        writeFileSync(
          `${base}.py`,
          buildPythonScript({
            appVersion: 'bench',
            source: file,
            rowCount: rows.length,
            header,
            delimiter: ',',
            encoding: 'utf-8',
            decimalColumns: [],
            malformedRows: 0,
            target,
            isClassification: arts.isClassification,
            classes: arts.classes,
            seed,
            classWeighting: false,
            specs: arts.pipeline.specs,
            featureCount: arts.pipeline.featureNames.length,
            split: {
              train: arts.trainIndices!,
              validation: arts.validationIndices ?? [],
              test: arts.testIndices,
            },
            models: results
              .filter((result) => result.ok)
              .map((result) => ({
                key: result.key,
                metrics: result.metrics,
                ...(result.trainedRows !== undefined && { trainedRows: result.trainedRows }),
              })),
          }),
        );
        writeFileSync(
          `${base}.matrix.json`,
          JSON.stringify({ train: arts.pipeline.transform(arts.trainIndices!) }),
        );
      }
    }
  }, 1_800_000);
});

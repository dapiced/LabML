import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

// NOTE: keep this title ASCII-only: it names the test-results directory.
test('python export: a run leaves the browser as a scikit-learn script', async ({
  page,
}, testInfo) => {
  await page.goto('/ml?demo=iris&target=species');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-python').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('labml-iris.py');
  const path = testInfo.outputPath('labml-iris.py');
  await download.saveAs(path);
  const script = readFileSync(path, 'utf8');

  // The run travels as one JSON block; the rest of the script is fixed text.
  const block = script.slice(script.indexOf("r'''\n") + 5, script.indexOf("\n''')"));
  const config = JSON.parse(block) as {
    source: string;
    rows: number;
    target: string;
    task: string;
    seed: number;
    classes: string[];
    features: { name: string; kind: string }[];
    split: { train: number[]; validation: number[]; test: number[] };
    models: { key: string; estimator: string; relation: string; lab: { accuracy?: number } }[];
    not_redone: string[];
  };
  expect(config).toMatchObject({
    source: 'iris.csv',
    rows: 150,
    target: 'species',
    task: 'classification',
    seed: 42,
  });
  expect(config.classes).toEqual(['setosa', 'versicolor', 'virginica']);
  expect(config.features.map((feature) => `${feature.name}:${feature.kind}`)).toEqual([
    'sepal_length:numeric',
    'sepal_width:numeric',
    'petal_length:numeric',
    'petal_width:numeric',
  ]);
  // The three splits of the run, row by row: 64 / 16 / 20 of 150.
  expect(config.split.train).toHaveLength(96);
  expect(config.split.validation).toHaveLength(24);
  expect(config.split.test).toHaveLength(30);
  expect(
    new Set([...config.split.train, ...config.split.validation, ...config.split.test]).size,
  ).toBe(150);
  // Every family of the leaderboard, with the figure the lab measured.
  expect(config.models.map((model) => model.key)).toEqual([
    'baseline',
    'logistic',
    'knn',
    'naiveBayes',
    'tree',
    'forest',
    'gbdt',
    'mlp',
  ]);
  expect(config.models.find((model) => model.key === 'baseline')?.lab.accuracy).toBeCloseTo(
    1 / 3,
    3,
  );
  expect(config.not_redone).toEqual(['ensemble']);
  // No row of the file is in it.
  expect(script).not.toContain('5.1,3.5,1.4,0.2');

  // It is Python, and it reads its own run with no library installed. `python3`
  // on Linux and macOS, `python` on Windows; CI has one.
  const interpreter = ['python3', 'python'].find((command) => {
    try {
      execFileSync(command, ['--version'], { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  });
  if (!interpreter) {
    expect(process.env.CI, 'CI must have a Python interpreter').toBeFalsy();
    return;
  }
  execFileSync(interpreter, ['-m', 'py_compile', path]);
  const printed = execFileSync(interpreter, [path, '--check'], { encoding: 'utf8' });
  expect(printed).toContain("iris.csv: 150 rows, target 'species', classification");
  expect(printed).toContain('Split: 96 train, 24 validation, 30 test.');
});

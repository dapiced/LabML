import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });
// Train, export, re-import and score three files: more than the default 30 s.
test.setTimeout(120_000);

// NOTE: keep this title ASCII-only: it names the test-results directory, and
// Chromium's setInputFiles silently drops files whose path is non-ASCII.
test('production check: the reference travels with the export and reads a batch', async ({
  page,
}, testInfo) => {
  await page.goto('/ml?demo=iris&target=species');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });
  // k-NN wins on iris and cannot be exported: inspect the forest.
  await page.getByRole('cell', { name: /Random forest/ }).click();
  await expect(page.getByRole('button', { name: 'Model (JSON)' })).toBeEnabled();

  // A live run checks a batch against its own rows: thirty field rows cannot
  // be told from the draw, and the panel says stable rather than cry drift.
  await page.getByTestId('batch-demo').click();
  const live = page.getByTestId('batch-result').getByTestId('production-check');
  await expect(live).toHaveAttribute('data-verdict', 'stable', { timeout: 30000 });
  await expect(live.getByTestId('production-columns')).toContainText(
    'None of the 4 columns the model uses has moved',
  );
  await expect(live.getByTestId('production-performance')).toContainText('inside the noise');

  // The export carries the reference: shares and counts, format 5.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Model (JSON)' }).click();
  const modelPath = testInfo.outputPath('model.json');
  await (await downloadPromise).saveAs(modelPath);
  const exported = JSON.parse(readFileSync(modelPath, 'utf8')) as {
    formatVersion: number;
    reference: { columns: { column: string }[]; predictions: { kind: string } };
  };
  expect(exported.formatVersion).toBe(5);
  expect(exported.reference.columns.map((column) => column.column)).toEqual([
    'sepal_length',
    'sepal_width',
    'petal_length',
    'petal_width',
  ]);
  expect(exported.reference.predictions.kind).toBe('classes');

  // The run is gone; only the file remains.
  await page.getByRole('button', { name: 'Change dataset' }).click();
  await expect(page.getByTestId('import-model-panel')).toBeVisible();
  await expect(
    page.getByTestId('runs-history').getByRole('link', { name: 'iris · species' }).first(),
  ).toBeVisible();
  await page.getByTestId('import-model-input').setInputFiles(modelPath);
  await expect(page.getByTestId('imported-manifest')).toBeVisible({ timeout: 15000 });

  // A batch of one species only, with no label: the inputs and the answers
  // have moved, and nothing says whether the model is wrong. Watch.
  const iris = (await (await page.request.get('/datasets/iris.csv')).text()).trim().split('\n');
  const onlyVirginica = [
    iris[0].split(',').slice(0, 4).join(','),
    ...iris
      .slice(1)
      .filter((line) => line.endsWith('virginica'))
      .map((line) => line.split(',').slice(0, 4).join(',')),
  ].join('\n');
  const driftedPath = testInfo.outputPath('virginica.csv');
  writeFileSync(driftedPath, onlyVirginica);
  await page.getByTestId('imported-score-input').setInputFiles(driftedPath);
  const check = page.getByTestId('imported-result').getByTestId('production-check');
  await expect(check).toHaveAttribute('data-verdict', 'watch', { timeout: 30000 });
  await expect(check.getByTestId('production-why')).toContainText('Label part of this batch');
  await expect(check.getByTestId('production-columns')).toContainText('petal_length: PSI');
  await expect(check.getByTestId('production-answers')).toContainText(
    'no longer answers the way it did',
  );
  await expect(check.getByTestId('production-performance')).toContainText('Not measured');

  // The whole file, labels included: nothing moved, and the labels say so.
  const wholePath = testInfo.outputPath('iris.csv');
  writeFileSync(wholePath, iris.join('\n'));
  await page.getByTestId('imported-score-input').setInputFiles(wholePath);
  await expect(check).toHaveAttribute('data-verdict', 'stable', { timeout: 30000 });
  await expect(check.getByTestId('production-performance')).toContainText('Accuracy');

  // An export written before format 5 still loads and scores; the panel says
  // it has no reference instead of showing columns it cannot read.
  const { reference: _dropped, ...older } = JSON.parse(readFileSync(modelPath, 'utf8')) as {
    reference: unknown;
    formatVersion: number;
  };
  void _dropped;
  const olderPath = testInfo.outputPath('model-v4.json');
  writeFileSync(olderPath, JSON.stringify({ ...older, formatVersion: 4 }));
  await page
    .getByTestId('import-model-panel')
    .getByRole('button', { name: 'Remove the imported model' })
    .click();
  await expect(page.getByTestId('imported-manifest')).toHaveCount(0);
  await page.getByTestId('import-model-input').setInputFiles(olderPath);
  await expect(page.getByTestId('imported-manifest')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('imported-score-input').setInputFiles(driftedPath);
  await expect(check.getByTestId('production-no-reference')).toContainText(
    'written before format 5',
  );
  await expect(check.getByTestId('production-columns')).toHaveCount(0);
});

import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });
// Train + export + re-import + score — a full loop needs more than 30 s.
test.setTimeout(90_000);

// NOTE: keep this title ASCII-only — it names the test-results directory, and
// Chromium's setInputFiles silently drops files whose path is non-ASCII.
test('the exported model comes back: export, reset, import, score', async ({ page }, testInfo) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();
  await page.selectOption('#target-select', 'species');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });

  // On iris the winner is k-NN — the one family that cannot export (it would
  // embed the training data). Inspect the forest instead, then export it.
  await page.getByRole('cell', { name: /Random forest/ }).click();
  await expect(page.getByRole('button', { name: 'Model (JSON)' })).toBeEnabled();

  // Export the inspected model as JSON (format v2 with the pipeline inside).
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Model (JSON)' }).click();
  const modelPath = testInfo.outputPath('model.json');
  await (await downloadPromise).saveAs(modelPath);

  // Fresh start: the run is gone, only the exported file remains. Wait for
  // the post-reset render to settle (the stored run shows in the history)
  // before touching the file input — a mid-remount CDP call lands nowhere.
  await page.getByRole('button', { name: 'Change dataset' }).click();
  await expect(page.getByTestId('import-model-panel')).toBeVisible();
  await expect(
    page.getByTestId('runs-history').getByRole('link', { name: 'iris · species' }),
  ).toBeVisible();

  await page.getByTestId('import-model-input').setInputFiles(modelPath);
  const manifest = page.getByTestId('imported-manifest');
  await expect(manifest).toBeVisible({ timeout: 15000 });
  await expect(manifest).toContainText('predicts species');
  await expect(manifest).toContainText('sepal_length');

  // Score the drifted field batch with the reborn model — no retraining.
  const fieldCsv = await page.request.get('/datasets/iris-field.csv');
  const csvPath = testInfo.outputPath('iris-field.csv');
  writeFileSync(csvPath, await fieldCsv.text());
  await page.getByTestId('imported-score-input').setInputFiles(csvPath);
  const result = page.getByTestId('imported-result');
  await expect(result).toBeVisible({ timeout: 30000 });
  await expect(result).toContainText('30 rows scored by');
  await expect(page.getByTestId('imported-metrics')).toContainText('Accuracy');
  await expect(page.getByTestId('imported-metrics')).toContainText('Original run (test)');

  // A wrong file is refused BY NAME, and the model stays loaded.
  const badPath = testInfo.outputPath('bad.csv');
  writeFileSync(badPath, 'a,b\n1,2\n');
  await page.getByTestId('imported-score-input').setInputFiles(badPath);
  await expect(page.getByTestId('imported-error')).toContainText('missing required columns');
  await expect(manifest).toBeVisible();
});

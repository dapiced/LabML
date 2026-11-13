import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });
test.setTimeout(120_000);

// NOTE: keep this title ASCII-only: it names the test-results directory, and
// Chromium's setInputFiles silently drops files whose path is non-ASCII.
test('submission: an unlabelled file becomes an identifier and a prediction', async ({
  page,
}, testInfo) => {
  await page.goto('/ml?demo=fraud&target=status');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });
  // A family with probabilities, and one that can be fitted again.
  await page.getByRole('cell', { name: /Logistic regression/ }).click();
  await expect(page.getByRole('button', { name: 'Model (JSON)' })).toBeEnabled();

  // What a competition hands out: an identifier, the features, no label. The
  // identifiers are not in order, so a sorted file would be caught.
  const fraud = (await (await page.request.get('/datasets/fraud.csv')).text()).trim().split('\n');
  const ids = Array.from({ length: 40 }, (_, i) => `tx-${(i * 17) % 40}`);
  const unlabelled = [
    `tx_id,${fraud[0].split(',').slice(0, 5).join(',')}`,
    ...fraud.slice(1, 41).map((line, i) => `${ids[i]},${line.split(',').slice(0, 5).join(',')}`),
  ].join('\n');
  const batchPath = testInfo.outputPath('holdout.csv');
  writeFileSync(batchPath, unlabelled);
  await page.getByTestId('batch-score').locator('input[type="file"]').setInputFiles(batchPath);
  const panel = page.getByTestId('submission-panel');
  await expect(panel).toBeVisible({ timeout: 30000 });

  // Nothing is chosen for the user: no identifier, no file.
  await expect(panel.getByTestId('submission-build')).toBeDisabled();
  await panel.getByTestId('submission-id-column').selectOption('tx_id');
  await expect(panel.getByTestId('submission-id-name')).toHaveValue('tx_id');
  await panel.getByTestId('submission-id-name').fill('TransactionId');
  await panel.getByTestId('submission-prediction-name').fill('is_fraud');
  await panel.getByTestId('submission-build').click();

  const result = panel.getByTestId('submission-result');
  await expect(result).toHaveAttribute('data-model', 'measured', { timeout: 30000 });
  await expect(result.getByTestId('submission-summary')).toContainText(
    '40 rows, the same as the scored file and in its order. Columns: TransactionId, is_fraud.',
  );
  await expect(result).toContainText('A submission is not a score');

  const labelDownload = page.waitForEvent('download');
  await result.getByTestId('submission-download').click();
  const labelFile = await labelDownload;
  expect(labelFile.suggestedFilename()).toBe('holdout-submission.csv');
  const labelPath = testInfo.outputPath('labels.csv');
  await labelFile.saveAs(labelPath);
  const labels = readFileSync(labelPath, 'utf8').trim().split('\n');
  expect(labels[0]).toBe('TransactionId,is_fraud');
  expect(labels).toHaveLength(41);
  expect(labels.slice(1).map((line) => line.split(',')[0])).toEqual(ids);
  for (const line of labels.slice(1)) expect(['clean', 'fraud']).toContain(line.split(',')[1]);

  // The same file as probabilities, from the family fitted again on every
  // labelled row: announced as a model nobody measured.
  await panel.getByTestId('submission-form-probability').check();
  await panel.getByTestId('submission-model-refit').check();
  await panel.getByTestId('submission-build').click();
  await expect(result).toHaveAttribute('data-model', 'refit', { timeout: 60000 });
  await expect(result.getByTestId('submission-model')).toContainText(
    'fitted again on the 640 labelled rows. Nobody measured this model',
  );
  const probaDownload = page.waitForEvent('download');
  await result.getByTestId('submission-download').click();
  const probaPath = testInfo.outputPath('probabilities.csv');
  await (await probaDownload).saveAs(probaPath);
  const probabilities = readFileSync(probaPath, 'utf8').trim().split('\n');
  expect(probabilities).toHaveLength(41);
  expect(probabilities.slice(1).map((line) => line.split(',')[0])).toEqual(ids);
  for (const line of probabilities.slice(1)) {
    const value = Number(line.split(',')[1]);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  }

  // Another model inspected: the submission of the previous one is gone.
  await page.getByRole('cell', { name: /Naive Bayes/ }).click();
  await expect(page.getByTestId('submission-panel')).toHaveCount(0);
});

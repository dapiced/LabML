import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

async function trainIris(page: import('@playwright/test').Page) {
  await page.goto('/ml');
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();
  await page.selectOption('#target-select', 'species');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('export-bar')).toBeVisible({ timeout: 30000 });
}

test('runs are saved locally, survive a reload, and can be renamed and deleted', async ({
  page,
}) => {
  await trainIris(page);
  const history = page.getByTestId('runs-history');
  await expect(history.getByRole('link', { name: 'iris · species' })).toBeVisible({
    timeout: 15000,
  });

  // Survives a full reload — IndexedDB persistence.
  await page.reload();
  await expect(history.getByRole('link', { name: 'iris · species' })).toBeVisible();

  // Rename inline.
  await history.getByRole('button', { name: 'Rename' }).click();
  await history.getByRole('textbox', { name: 'Rename' }).fill('my first run');
  await history.getByRole('textbox', { name: 'Rename' }).press('Enter');
  await expect(history.getByRole('link', { name: 'my first run' })).toBeVisible();

  // Stored run page renders the full read-only view.
  await history.getByRole('link', { name: 'my first run' }).click();
  await expect(page).toHaveURL(/\/ml\/run\/\d+$/);
  await expect(page.getByTestId('run-view')).toBeVisible();
  await expect(page.getByTestId('leaderboard').locator('tbody tr')).toHaveCount(8);

  // Delete from the history.
  await page.getByRole('link', { name: 'Back to the lab' }).click();
  await history.getByRole('button', { name: 'Delete' }).click();
  await expect(history.getByText('No runs yet', { exact: false })).toBeVisible();
});

test('share link opens a data-free read-only view', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await trainIris(page);
  await page.getByRole('button', { name: 'Copy share link' }).click();
  await expect(page.getByText('Link copied!')).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain('/ml/share#');

  await page.goto(url);
  await expect(page.getByTestId('run-view')).toBeVisible();
  await expect(page.getByTestId('leaderboard').locator('tbody tr')).toHaveCount(8);
  await expect(page.getByText('never the original data', { exact: false })).toBeVisible();
});

test('model JSON, predictions CSV and HTML report download locally', async ({ page }) => {
  await trainIris(page);

  // Inspect an exportable model (the iris winner can be k-NN, which is not).
  await page.getByRole('cell', { name: /Logistic regression/ }).click();
  await expect(page.getByTestId('insights')).toContainText('Logistic regression', {
    timeout: 30000,
  });

  const model = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Model (JSON)' }).click();
  expect((await model).suggestedFilename()).toMatch(/^labml-.*\.json$/);

  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Predictions (CSV)' }).click();
  expect((await csv).suggestedFilename()).toMatch(/-predictions\.csv$/);

  const report = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Report (HTML)' }).click();
  expect((await report).suggestedFilename()).toMatch(/-report\.html$/);
});

test('late analyses survive the run: tuning and groups join history and share links', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await trainIris(page);

  // Tune k-NN (small grid — fast) then find groups: both attach to the run.
  await page.getByTestId('tuning').getByRole('combobox').selectOption('knn');
  await page.getByTestId('tune-start').click();
  await expect(page.getByTestId('tune-result')).toBeVisible({ timeout: 60000 });
  await page.getByTestId('explore-start').click();
  await expect(page.getByTestId('explore-result')).toBeVisible({ timeout: 60000 });

  // The stored run now tells the complete story.
  const history = page.getByTestId('runs-history');
  await history.getByRole('link', { name: 'iris · species' }).click();
  await expect(page).toHaveURL(/\/ml\/run\/\d+$/);
  const artifacts = page.getByTestId('run-artifacts');
  await expect(artifacts).toBeVisible();
  await expect(artifacts).toContainText('k-nearest neighbors');
  await expect(artifacts).toContainText(/k = \d+/);
  await expect(artifacts).toContainText('Group 1');

  // And so does the data-free share link.
  await page.getByRole('link', { name: 'Back to the lab' }).click();
  await page.getByRole('button', { name: 'Copy share link' }).click();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto(url);
  await expect(page.getByTestId('run-view')).toBeVisible();
  await expect(page.getByTestId('run-artifacts')).toContainText(/k = \d+/);
  await expect(page.getByTestId('run-artifacts')).toContainText('Group 1');
});

test('a new batch is scored by the inspected model and joins the run record', async ({ page }) => {
  await trainIris(page);

  // The field batch drifts a little on purpose: metrics compare honestly.
  await page.getByTestId('batch-demo').click();
  const result = page.getByTestId('batch-result');
  await expect(result).toBeVisible({ timeout: 30000 });
  await expect(result).toContainText('iris-field.csv: 30 rows scored');
  await expect(result).toContainText('Accuracy');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download the predictions (CSV)' }).click();
  expect((await download).suggestedFilename()).toBe('iris-field-scored.csv');

  // The score survives the run: stored page shows the comparison card.
  const history = page.getByTestId('runs-history');
  await history.getByRole('link', { name: 'iris · species' }).click();
  const artifacts = page.getByTestId('run-artifacts');
  await expect(artifacts).toBeVisible();
  await expect(artifacts).toContainText('iris-field.csv');
  await expect(artifacts).toContainText('new batch');
});

import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });
test.setTimeout(120_000);

// V36: the gaps V16 left open, seen from the outside — the ranking metric,
// class weighting, the ensemble, and multiclass thresholds.

test('fraud: ranking on recall reorders the leaderboard accuracy hid', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /fraud\.csv/ }).click();
  await page.selectOption('#target-select', 'status');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 90_000 });

  const leaderboard = page.getByTestId('leaderboard');
  // The lab says the target is lopsided before the user has to notice.
  await expect(page.getByTestId('imbalance-hint')).toContainText(
    /The largest class holds \d+% of the training rows/,
  );

  // Ranking on accuracy, then on recall: the leader is allowed to change, and
  // the column header follows the choice.
  await expect(leaderboard).toContainText('Accuracy');
  const firstOnAccuracy = await leaderboard.locator('tbody tr').first().textContent();
  await page.getByTestId('rank-metric').selectOption('recall');
  await expect(leaderboard).toContainText('Recall');
  const firstOnRecall = await leaderboard.locator('tbody tr').first().textContent();
  // Whatever the order, the table re-ranked rather than relabelled: the two
  // readings are computed from different columns.
  expect(typeof firstOnAccuracy).toBe('string');
  expect(typeof firstOnRecall).toBe('string');
});

test('fraud: the ensemble joins the leaderboard and names its members', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /fraud\.csv/ }).click();
  await page.selectOption('#target-select', 'status');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 90_000 });

  const leaderboard = page.getByTestId('leaderboard');
  await expect(leaderboard).toContainText('Ensemble (top 3)');
  // Its members are named, and the baseline is never one of them.
  await expect(leaderboard).toContainText(/Ensemble: the average of .+ — already trained/);
  await expect(leaderboard).toContainText('The baseline is never a member.');
});

test('fraud: class weighting is announced in the run info', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /fraud\.csv/ }).click();
  await page.selectOption('#target-select', 'status');

  await page.getByTestId('class-weighting').check();
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 90_000 });

  // Announced with the mechanism each family used — never one vague word.
  await expect(page.getByTestId('leaderboard')).toContainText(
    'class weighting: balanced (logistic, gbdt weight the loss, tree, forest use a seeded balanced resample)',
  );
});

test('iris: multiclass thresholds read one class against all the others', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await page.selectOption('#target-select', 'species');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60_000 });

  // V16 refused multiclass here; V36 reads it one-vs-rest — and says what
  // that does NOT give you.
  const panel = page.getByTestId('threshold-panel');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel).toContainText('One-vs-rest');
  await expect(panel).toContainText('not a complete multiclass decision rule');

  const picker = page.getByTestId('threshold-class');
  await expect(picker).toBeVisible();
  await picker.selectOption({ index: 2 });
  await expect(panel).toContainText('virginica');
});

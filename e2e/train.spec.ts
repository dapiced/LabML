import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('iris: training fills the leaderboard with every ranked model', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();
  await page.selectOption('#target-select', 'species');
  await expect(page.getByTestId('task-badge')).toBeVisible();

  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });

  const rows = page.getByTestId('leaderboard').locator('tbody tr');
  // V36: eight zoo families + the ensemble built from the top three.
  await expect(rows).toHaveCount(9);
  await expect(page.getByText('best', { exact: true })).toBeVisible();
  await expect(page.getByText('baseline', { exact: true })).toBeVisible();
  await expect(page.getByText(/seed 42 · split/)).toBeVisible();
});

test('mpg: regression leaderboard ranks by RMSE', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /mpg\.csv/ }).click();
  await expect(page.getByText('398 rows · 9 columns')).toBeVisible();
  await page.selectOption('#target-select', 'mpg');
  await expect(page.getByTestId('task-badge')).toHaveText('Regression');

  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });

  const rows = page.getByTestId('leaderboard').locator('tbody tr');
  // V36: seven regression families + the mean-of-top-three ensemble.
  await expect(rows).toHaveCount(8);
  await expect(
    page.getByTestId('leaderboard').getByRole('columnheader', { name: 'RMSE' }),
  ).toBeVisible();
  await expect(page.getByText('best', { exact: true })).toBeVisible();
});

test('V47: the target and the feature set are locked while a run trains', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /titanic\.csv/ }).click();
  await page.selectOption('#target-select', 'survived');
  await expect(page.getByTestId('task-badge')).toBeVisible();

  await page.getByTestId('train-button').click();
  // A result filed under a target it was not trained for is the defect this
  // guards against: nothing that defines the question may move mid-run.
  await expect(page.locator('#target-select')).toBeDisabled();
  const ageCard = page.getByTestId('column-card-age');
  await expect(ageCard.getByRole('button', { name: 'Set as target' })).toBeDisabled();
  await expect(ageCard.getByRole('button', { name: /^(Exclude|Include)$/ })).toBeDisabled();

  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#target-select')).toBeEnabled();
  await expect(ageCard.getByRole('button', { name: 'Set as target' })).toBeEnabled();
});

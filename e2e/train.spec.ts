import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('iris: training fills the leaderboard with 6 ranked models', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();
  await page.selectOption('#target-select', 'species');
  await expect(page.getByTestId('task-badge')).toBeVisible();

  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });

  const rows = page.getByTestId('leaderboard').locator('tbody tr');
  await expect(rows).toHaveCount(6);
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
  await expect(rows).toHaveCount(5);
  await expect(page.getByRole('columnheader', { name: 'RMSE' })).toBeVisible();
  await expect(page.getByText('best', { exact: true })).toBeVisible();
});

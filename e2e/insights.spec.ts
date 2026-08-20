import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('iris: insights tell the full story and what-if reacts to inputs', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();
  await page.selectOption('#target-select', 'species');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });

  // Insights arrive automatically for the winning model.
  await expect(page.getByTestId('insights')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('plain-read')).toContainText('held-out test rows');
  await expect(page.getByTestId('confusion-matrix')).toBeVisible();
  await expect(page.getByTestId('importance')).toBeVisible();

  // What-if: an unmistakable setosa (tiny petals) must be predicted as setosa.
  await expect(page.getByTestId('what-if-prediction')).toBeVisible({ timeout: 15000 });
  await page.getByLabel('petal_length').fill('1.3');
  await page.getByLabel('petal_width').fill('0.2');
  await expect(page.getByTestId('what-if-prediction')).toHaveText('setosa', { timeout: 15000 });

  // Clicking a leaderboard row switches the inspected model.
  await page.getByRole('cell', { name: /Gaussian Naive Bayes/ }).click();
  await expect(page.getByTestId('insights')).toContainText('Gaussian Naive Bayes', {
    timeout: 30000,
  });
});

test('mpg: regression insights show scatter and residuals', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /mpg\.csv/ }).click();
  await expect(page.getByText('398 rows · 9 columns')).toBeVisible();
  await page.selectOption('#target-select', 'mpg');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });

  await expect(page.getByTestId('insights')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('scatter')).toBeVisible();
  await expect(page.getByTestId('plain-read')).toContainText('on average');
  await expect(page.getByTestId('what-if')).toBeVisible();
});

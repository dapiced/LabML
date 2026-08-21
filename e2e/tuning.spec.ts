import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('iris: hyperparameter search reports a tuned score and its trials', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();
  await page.selectOption('#target-select', 'species');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });

  const tuning = page.getByTestId('tuning');
  await expect(tuning).toBeVisible();
  // k-NN keeps the search fast on a 150-row dataset.
  await tuning.getByRole('combobox').selectOption('knn');
  await page.getByTestId('tune-start').click();

  const result = page.getByTestId('tune-result');
  await expect(result).toBeVisible({ timeout: 60000 });
  await expect(result).toContainText('k-nearest neighbors');
  await expect(result).toContainText(/k = \d+/);
  await expect(result).toContainText('Cross-validation:');
  const testScore = await page.getByTestId('tune-test-score').textContent();
  expect(Number.parseFloat((testScore ?? '0').replace(',', '.'))).toBeGreaterThan(0.7);

  await result.locator('summary').click();
  await expect(result.locator('table')).toBeVisible();
});

test('iris: the what-if prediction explains itself with Shapley bars', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();
  await page.selectOption('#target-select', 'species');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('what-if-prediction')).toBeVisible({ timeout: 30000 });

  await page.getByTestId('explain-button').click();
  const explanation = page.getByTestId('explanation');
  await expect(explanation).toBeVisible({ timeout: 30000 });
  await expect(explanation).toContainText(/toward or away from/);
  await expect(explanation).toContainText('petal_length');
  await expect(explanation).toContainText('Shapley');

  // Changing an input invalidates the explanation until asked again.
  await page.getByLabel('petal_length').fill('1.3');
  await expect(page.getByTestId('explain-button')).toBeVisible({ timeout: 15000 });
});

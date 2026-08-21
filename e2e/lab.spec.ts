import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('iris demo: profile appears and target detection finds 3 classes', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();
  await expect(page.getByTitle('sepal_length')).toBeVisible();
  await page.selectOption('#target-select', 'species');
  await expect(page.getByTestId('task-badge')).toHaveText('Multi-class classification · 3 classes');
});

test('titanic demo: leak detection flags the alive column', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /titanic\.csv/ }).click();
  await expect(page.getByText('891 rows · 15 columns')).toBeVisible();
  await page.selectOption('#target-select', 'survived');
  await expect(page.getByTestId('task-badge')).toHaveText('Binary classification');
  await expect(page.getByTestId('leak-alert')).toContainText('alive');
});

test('mpg demo: continuous target is detected as regression', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /mpg\.csv/ }).click();
  await expect(page.getByText('398 rows · 9 columns')).toBeVisible();
  await page.selectOption('#target-select', 'mpg');
  await expect(page.getByTestId('task-badge')).toHaveText('Regression');
});

test('uploading an Excel file works like a CSV', async ({ page }) => {
  await page.goto('/ml');
  await page.locator('input[type="file"]').setInputFiles('e2e/fixtures/pets.xlsx');
  await expect(page.getByText('12 rows · 4 columns')).toBeVisible({ timeout: 20000 });
  await page.selectOption('#target-select', 'species');
  await expect(page.getByTestId('task-badge')).toHaveText('Binary classification');
});

test('uploading a CSV excludes identifiers and constants automatically', async ({ page }) => {
  await page.goto('/ml');
  await page.locator('input[type="file"]').setInputFiles('e2e/fixtures/pets.csv');
  await expect(page.getByText('12 rows · 4 columns')).toBeVisible();
  await page.selectOption('#target-select', 'species');
  await expect(page.getByTestId('task-badge')).toHaveText('Binary classification');
  await expect(page.getByText('1 of 4 columns kept for training')).toBeVisible();
  await expect(page.getByText('dropped id', { exact: true })).toBeVisible();
  await expect(page.getByText('constant', { exact: true })).toBeVisible();
});

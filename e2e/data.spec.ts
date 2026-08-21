import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('data studio audits the messy demo and cleans it live', async ({ page }) => {
  await page.goto('/data');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Diagnose and clean');

  await page.getByRole('button', { name: /cafe-sales\.csv/ }).click();
  await expect(page.getByText('118 rows · 8 columns')).toBeVisible();

  // Both scores render; the "before" score reflects the planted issues.
  await expect(page.getByTestId('quality-score')).toHaveCount(2);
  const before = await page.getByTestId('quality-score').first().textContent();
  expect(Number.parseInt(before ?? '0', 10)).toBeLessThan(90);

  // Every planted issue family is reported.
  await expect(page.getByTestId('issue-missing')).toBeVisible();
  await expect(page.getByTestId('issue-duplicates')).toContainText('6 duplicate rows');
  await expect(page.getByTestId('issue-messy')).toBeVisible();
  await expect(page.getByTestId('issue-outliers')).toBeVisible();
  await expect(page.getByTestId('issue-structural')).toContainText('currency');

  // The default recipe already dropped the 6 duplicates.
  await expect(page.getByTestId('recipe-result')).toContainText('112 rows · 8 columns');

  // Dropping structural columns removes the constant and near-empty ones.
  await page.getByRole('checkbox', { name: 'Drop constant and near-empty columns' }).check();
  await expect(page.getByTestId('recipe-result')).toContainText('112 rows · 6 columns');

  // Dropping rows with missing values instead of imputing shrinks the rows.
  await page.getByLabel('Missing values').selectOption('dropRows');
  await expect(page.getByTestId('recipe-result')).not.toContainText('112 rows');
});

test('data studio exports and hands the cleaned dataset to the ML Lab', async ({ page }) => {
  await page.goto('/data');
  await page.getByRole('button', { name: /cafe-sales\.csv/ }).click();
  await expect(page.getByTestId('recipe-result')).toBeVisible();

  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download the cleaned CSV' }).click();
  expect((await csvDownload).suggestedFilename()).toBe('cafe-sales-clean.csv');

  const recipeDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download the recipe (JSON)' }).click();
  expect((await recipeDownload).suggestedFilename()).toBe('cafe-sales-recipe.json');

  // Hand-off: the ML Lab opens with the cleaned dataset already parsed.
  await page.getByRole('button', { name: 'Open in the ML Lab' }).click();
  await expect(page).toHaveURL(/\/ml$/);
  await expect(page.getByText('112 rows · 8 columns')).toBeVisible();
});

test('recipes are replayable: derive dates, force a type, export, re-import', async ({ page }) => {
  await page.goto('/data');
  await page.getByRole('button', { name: /cafe-sales\.csv/ }).click();
  await expect(page.getByTestId('recipe-result')).toContainText('112 rows · 8 columns');

  // Date expansion: the `date` column yields _year/_month/_weekday.
  await page.getByRole('checkbox', { name: /Expand date columns/ }).check();
  await expect(page.getByTestId('recipe-result')).toContainText('112 rows · 11 columns');
  await expect(page.getByText(/date_year, date_month, date_weekday/)).toBeVisible();

  // Force a column type from the types panel.
  await page.locator('summary', { hasText: 'Column types' }).click();
  await page
    .locator('label', { hasText: 'quantity' })
    .locator('select')
    .selectOption('categorical');
  await expect(page.getByTestId('recipe-result')).toContainText('112 rows · 11 columns');

  // Export the recipe, revert the option, then replay the downloaded file.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download the recipe (JSON)' }).click();
  const recipePath = await (await download).path();
  await page.getByRole('checkbox', { name: /Expand date columns/ }).uncheck();
  await expect(page.getByTestId('recipe-result')).toContainText('112 rows · 8 columns');

  await page.locator('input[accept*="json"]').setInputFiles(recipePath!);
  await expect(page.getByTestId('recipe-imported')).toContainText('cafe-sales.csv');
  await expect(page.getByTestId('recipe-result')).toContainText('112 rows · 11 columns');
});

test('drift check compares a new batch against the loaded reference', async ({ page }) => {
  await page.goto('/data');
  await page.getByRole('button', { name: /cafe-sales\.csv/ }).click();
  await expect(page.getByTestId('recipe-result')).toBeVisible();

  // Compare the June demo batch (shifted prices, new Matcha product, city mix).
  await page.getByTestId('drift-demo').click();
  const result = page.getByTestId('drift-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('cafe-sales-june.csv vs the reference');

  // The planted numeric shift is graded strong and both means are shown.
  const priceRow = result.locator('tr', { hasText: 'unit_price' });
  await expect(priceRow).toContainText('strong drift');
  await expect(priceRow).toContainText('mean');

  // The new product shows up as a new category.
  const productRow = result.locator('tr', { hasText: 'product' });
  await expect(productRow).toContainText('Matcha');
});

test('a catalog joins the dataset and the recipe drops multivariate anomalies', async ({
  page,
}) => {
  await page.goto('/data');
  await page.getByRole('button', { name: /cafe-sales\.csv/ }).click();
  await expect(page.getByText('118 rows · 8 columns')).toBeVisible();

  // Join the product catalog on the shared key.
  await page.getByTestId('join-demo').click();
  await expect(page.getByTestId('join-ready')).toBeVisible();
  await expect(page.getByTestId('join-key')).toHaveValue('product');
  await page.getByTestId('join-apply').click();

  const result = page.getByTestId('join-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('116 of 118 rows matched, 2 columns added');
  await expect(result).toContainText('+ category');
  // The messy key variants become named orphans — a finding, not a silence.
  await expect(page.getByTestId('join-orphans')).toContainText('LATTE');

  // The joined result IS the dataset: shape and recipe restart from it.
  await expect(page.getByText('118 rows · 10 columns')).toBeVisible();
  await expect(page.getByTestId('recipe-result')).toContainText('112 rows · 10 columns');

  // The seeded isolation forest drops the 5 multivariate anomalies.
  await page.getByRole('checkbox', { name: /multivariate anomalies/ }).check();
  await expect(page.getByTestId('recipe-result')).toContainText('107 rows · 10 columns');
});

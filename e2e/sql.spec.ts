import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

// One test, one engine: downloading and instantiating ~18 MB of WebAssembly
// twice in parallel is the slowest thing this suite could do for no gain.
test.describe.configure({ timeout: 180_000 });

test('the SQL console answers a real query and reports the engine own errors', async ({ page }) => {
  await page.goto('/data');
  await page.getByRole('button', { name: /cafe-sales\.csv/ }).click();
  await expect(page.getByTestId('sql-panel')).toBeVisible();

  await page.getByTestId('sql-open').click();
  // DuckDB downloads from our own origin, instantiates, and the demo file is
  // attached as the `dataset` view.
  await expect(page.getByTestId('sql-input')).toBeVisible({ timeout: 150_000 });

  await page
    .getByTestId('sql-input')
    .fill(
      'SELECT product, COUNT(*) AS n FROM dataset GROUP BY product ORDER BY n DESC, product LIMIT 3',
    );
  await page.getByTestId('sql-run').click();

  const result = page.getByTestId('sql-result');
  await expect(result).toBeVisible({ timeout: 60_000 });
  await expect(result).toContainText('3 rows');
  await expect(result.locator('thead th')).toHaveCount(2);
  await expect(result.locator('tbody tr')).toHaveCount(3);
  // A GROUP BY the keyword engine could not do, computed by DuckDB itself.
  await expect(result).toContainText('Cappuccino');

  // An invalid column is reported with DuckDB's own message, not a shrug.
  await page.getByTestId('sql-input').fill('SELECT nope FROM dataset');
  await page.getByTestId('sql-run').click();
  const error = page.getByTestId('sql-error');
  await expect(error).toBeVisible({ timeout: 60_000 });
  await expect(error).toContainText(/nope/i);
});

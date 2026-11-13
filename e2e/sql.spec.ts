import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

// One test, one engine: downloading and instantiating ~18 MB of WebAssembly
// twice in parallel is the slowest thing this suite could do for no gain.
test.describe.configure({ timeout: 180_000 });

test('the SQL console answers a real query and reports the engine own errors', async ({
  page,
}, testInfo) => {
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

  // V69: an export is the query, not the screen. 590 rows come back, 200 are
  // painted, and every one of them leaves the console.
  await page
    .getByTestId('sql-input')
    .fill(
      'SELECT a.*, CASE WHEN r.range = 0 THEN NULL ELSE a.quantity END AS q2 FROM dataset a, range(5) r;',
    );
  await page.getByTestId('sql-run').click();
  await expect(result).toContainText('First 200 rows shown out of 590', { timeout: 60_000 });
  await expect(result.locator('tbody tr')).toHaveCount(200);
  await expect(page.getByTestId('sql-export-note')).toContainText('they carry all 590 rows');

  const csvDownload = page.waitForEvent('download');
  await page.getByTestId('sql-export-csv').click();
  const csvFile = await csvDownload;
  expect(csvFile.suggestedFilename()).toMatch(/^query-[0-9a-f]{8}\.csv$/);
  const csvPath = testInfo.outputPath('query.csv');
  await csvFile.saveAs(csvPath);
  const lines = readFileSync(csvPath, 'utf8').trim().split('\n');
  expect(lines).toHaveLength(591);
  expect(lines[0]).toBe('order_id,date,product,city,quantity,unit_price,currency,notes,q2');
  // A NULL is an empty cell, not the mark the console paints for it.
  expect(lines.join('\n')).not.toContain('∅');
  expect(lines.filter((line) => line.endsWith(','))).toHaveLength(118);

  const parquetDownload = page.waitForEvent('download');
  await page.getByTestId('sql-export-parquet').click();
  const parquetFile = await parquetDownload;
  expect(parquetFile.suggestedFilename()).toMatch(/^query-[0-9a-f]{8}\.parquet$/);
  const parquetPath = testInfo.outputPath('query.parquet');
  await parquetFile.saveAs(parquetPath);
  expect(readFileSync(parquetPath).subarray(0, 4).toString()).toBe('PAR1');

  // The lab receives the whole result, and reads the column with NULLs as a
  // number with missing values: it used to get 200 rows and a text column.
  await page.getByTestId('sql-to-lab').click();
  await expect(page).toHaveURL(/\/ml/);
  await expect(page.getByText('590 rows · 9 columns')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('column-card-q2')).toContainText(/numeric/i);
});

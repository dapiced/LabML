import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

// NOTE: keep this title ASCII-only: it names the test-results directory, and
// Chromium's setInputFiles silently drops files whose path is non-ASCII.
test('data contract: export it, keep it on the same file, break it on a degraded one', async ({
  page,
}, testInfo) => {
  await page.goto('/data');
  await page.getByRole('button', { name: /cafe-sales\.csv/ }).click();
  await expect(page.getByTestId('recipe-result')).toBeVisible();

  // Freeze what this file looks like.
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('contract-export').click();
  const contractPath = testInfo.outputPath('cafe-sales.contract.json');
  await (await downloadPromise).saveAs(contractPath);
  const text = readFileSync(contractPath, 'utf8');
  const contract = JSON.parse(text) as {
    format: string;
    rowCount: number;
    columns: { name: string; reading: string }[];
    rules: { rule: string; columns: string[]; failures: number }[];
  };
  expect(contract.format).toBe('labml-data-contract/1');
  expect(contract.rowCount).toBe(118);
  expect(contract.columns.find((column) => column.name === 'quantity')?.reading).toBe('number');
  expect(
    contract.rules.map((rule) => `${rule.rule}:${rule.columns.join('+')}:${rule.failures}`),
  ).toEqual(['futureDate:date:0', 'negativeAmount:quantity:0', 'negativeAmount:unit_price:1']);
  // Names, bounds, shares and counts: no order of the file is in it.
  expect(text).not.toContain('1001');

  // The file it was drawn from keeps every clause.
  await page.getByTestId('contract-input').setInputFiles(contractPath);
  const result = page.getByTestId('contract-result');
  await expect(result).toHaveAttribute('data-verdict', 'kept', { timeout: 30000 });
  await expect(result).toContainText('0 broken, 0 warnings');

  // A degraded export: the city column is gone and a third of the quantities
  // are negative. The quality report's own rule goes quiet at that share.
  const source = (await (await page.request.get('/datasets/cafe-sales.csv')).text())
    .trim()
    .split('\n');
  const header = source[0].split(',');
  const cityAt = header.indexOf('city');
  const quantityAt = header.indexOf('quantity');
  const degraded = source.map((line, row) => {
    const cells = line.split(',');
    if (row > 0 && row % 3 === 0) cells[quantityAt] = '-5';
    cells.splice(cityAt, 1);
    return cells.join(',');
  });
  const degradedPath = testInfo.outputPath('cafe-degraded.csv');
  writeFileSync(degradedPath, degraded.join('\n'));
  await page.getByRole('button', { name: 'Start over' }).click();
  await page.getByTestId('data-file-input').setInputFiles(degradedPath);
  await expect(page.getByTestId('recipe-result')).toBeVisible();
  // The quality report still shows the one negative price, and says nothing of
  // the thirty-nine negative quantities: its rule no longer applies to them.
  await expect(page.getByTestId('issue-validity')).toContainText('unit_price');
  await expect(page.getByTestId('issue-validity')).not.toContainText('quantity');

  await page.getByTestId('contract-input').setInputFiles(contractPath);
  await expect(result).toHaveAttribute('data-verdict', 'broken', { timeout: 30000 });
  await expect(page.getByTestId('contract-verdict')).toHaveText('contract broken');
  await expect(page.getByTestId('contract-schema')).toContainText(
    '« city » is absent from this file',
  );
  await expect(page.getByTestId('contract-rule')).toContainText(
    'no negative amount, on « quantity »: 39 of',
  );
  await expect(page.getByTestId('contract-rule')).toContainText(
    'against 0 of 116 at the reference',
  );

  // Anything that is not a contract is refused by name, and nothing is checked.
  const notAContract = testInfo.outputPath('recipe.json');
  writeFileSync(notAContract, JSON.stringify({ options: {} }));
  await page.getByTestId('contract-input').setInputFiles(notAContract);
  await expect(page.getByTestId('contract-refused')).toContainText(
    'recipe.json is not a LabML data contract',
  );
  await expect(result).toHaveCount(0);
});

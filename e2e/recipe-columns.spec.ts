import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });
test.setTimeout(120_000);

/**
 * V39 — a recipe that works column by column.
 *
 * The rule worth pinning in a real browser is the honest one: filling a blank
 * without marking where it was erases information, and the studio has to say
 * so rather than quietly producing a tidier table.
 */
test('a column overrides the global strategy, and the indicator lands beside it', async ({
  page,
}) => {
  await page.goto('/data');
  await page.getByRole('button', { name: /cafe-sales\.csv/ }).click();
  await expect(page.getByTestId('recipe-result')).toBeVisible({ timeout: 60_000 });

  await page.getByText('Per-column steps', { exact: true }).click();
  const column = page.getByTestId('recipe-column-quantity');
  await expect(column).toBeVisible();

  // The default is shown as a default, not as a silent behaviour.
  const strategy = column.getByLabel('Missing-value strategy for quantity');
  await expect(strategy).toHaveValue('auto');
  await expect(strategy.locator('option[value="auto"]')).toContainText('default');

  // Override it, and mark where the blanks were.
  await strategy.selectOption('mean');
  await column.getByRole('checkbox').check();

  // The indicator column exists and is named after the column it describes.
  await expect(page.getByTestId('recipe-result')).toContainText('9 columns');
  // The « after » preview is where the new column has to be visible: an
  // indicator nobody can see is not a mark, it is a hidden side effect.
  await page.getByRole('button', { name: 'After', exact: true }).click();
  await expect(page.getByTestId('data-preview')).toContainText('quantity_absent');
});

test('filling without marking is announced, not left silent', async ({ page }) => {
  await page.goto('/data');
  await page.getByRole('button', { name: /cafe-sales\.csv/ }).click();
  await expect(page.getByTestId('recipe-result')).toBeVisible({ timeout: 60_000 });

  // The demo recipe imputes by default, and nothing is marked — so the studio
  // must say which columns lost the information that they were blank.
  const warning = page.getByTestId('recipe-unmarked');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('rarely blank at random');

  // Marking one column removes it from the warning.
  await page.getByText('Per-column steps', { exact: true }).click();
  await page.getByTestId('recipe-column-quantity').getByRole('checkbox').check();
  await expect(warning).not.toContainText('quantity,');
});

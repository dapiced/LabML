import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });
test.setTimeout(120_000);

// NOTE: keep this title ASCII-only: it names the test-results directory.
test('titanic: the run says which cells it filled in, and how many', async ({ page }) => {
  await page.goto('/ml?demo=titanic&target=survived');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 90000 });

  const notice = page.getByTestId('filled-notice').first();
  await expect(notice).toContainText('Cells the lab filled in before training');
  // deck is 77 % empty: kept, since under the 95 % that sets a column aside,
  // and most of what the models read in it is its most frequent value.
  const deck = notice.getByTestId('filled-deck');
  await expect(deck).toHaveAttribute('data-mostly', 'true');
  await expect(deck).toContainText('688 cells were empty of 891 (77 %). Filled with "C".');
  const age = notice.getByTestId('filled-age');
  await expect(age).toHaveAttribute('data-mostly', 'false');
  await expect(age).toContainText('177 cells were empty of 891 (20 %)');

  // Excluded, the column is no longer filled, and no longer counted.
  await page.getByTestId('column-card-deck').getByRole('button', { name: 'Exclude' }).click();
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 90000 });
  await expect(page.getByTestId('filled-deck')).toHaveCount(0);
  await expect(page.getByTestId('filled-age').first()).toBeVisible();
});

import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('iris: an opted-in dataset survives reload, reopens, and links its runs', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();
  await page.getByTestId('dataset-keep').click();
  await expect(page.getByTestId('dataset-kept')).toBeVisible();

  // Train so the auto-saved run gets linked to the kept dataset.
  await page.selectOption('#target-select', 'species');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });

  // Reload: memory is wiped, the browser copy survives.
  await page.reload();
  const list = page.getByTestId('saved-datasets');
  await expect(list).toBeVisible();
  await expect(list).toContainText('iris.csv');
  await expect(list).toContainText('150 × 5');

  await list.getByRole('button', { name: 'Reopen in the lab' }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();
  await expect(page.getByTestId('dataset-kept')).toBeVisible();

  // The stored run remembers its data and can bring it back.
  await page.getByTestId('runs-history').getByRole('link', { name: 'iris · species' }).click();
  await page.getByTestId('run-reopen-dataset').click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();

  // Forgetting is explicit and immediate — the current dataset loses its badge.
  await page
    .getByTestId('saved-datasets')
    .getByRole('button', { name: 'Forget this dataset' })
    .click();
  await expect(page.getByTestId('saved-datasets')).not.toBeVisible();
  await expect(page.getByTestId('dataset-keep')).toBeVisible();
});

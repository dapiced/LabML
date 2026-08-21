import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });
test.setTimeout(90_000);

test('iris: two runs compare side by side — features diff, deltas, verdict', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();
  await page.selectOption('#target-select', 'species');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });

  // Run B: same data, one feature dropped — the iterative gesture.
  await page
    .getByTestId('column-card-petal_width')
    .getByRole('button', { name: 'Exclude' })
    .click();
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });

  // Select both stored runs (newest first: B then A) and open the comparison.
  const history = page.getByTestId('runs-history');
  const checkboxes = history.getByRole('checkbox');
  await expect(checkboxes).toHaveCount(2);
  await checkboxes.nth(1).check(); // run A (older)
  await checkboxes.nth(0).check(); // run B (newer)
  await page.getByTestId('compare-open').click();

  await expect(page.getByTestId('compare-page')).toBeVisible();
  await expect(page.getByText('same dataset')).toBeVisible();
  await expect(page.getByText('same target')).toBeVisible();

  // The feature diff names what changed between A and B.
  await expect(page.getByText(/petal_width/).first()).toBeVisible();
  await expect(page.getByText('3 features kept on both sides')).toBeVisible();

  // Per-model deltas and the plain-language read are there.
  await expect(page.getByTestId('compare-models')).toContainText('Naive baseline');
  await expect(page.getByTestId('compare-read')).toContainText('The best model goes from');

  // Both runs carry v20 intervals → the cross-run verdict shows.
  await expect(page.getByTestId('compare-intervals')).toContainText('[');
});

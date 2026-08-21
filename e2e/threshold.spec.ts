import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('fraud: the decision threshold bends to the cost matrix and joins the run', async ({
  page,
}) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /fraud\.csv/ }).click();
  await expect(page.getByText('640 rows · 6 columns')).toBeVisible();
  await page.selectOption('#target-select', 'status');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });

  // Inspect a probabilistic model so the imbalance tools apply.
  await page.getByRole('cell', { name: /Gradient boosting/ }).click();
  const panel = page.getByTestId('threshold-panel');
  await expect(panel).toBeVisible({ timeout: 30000 });
  await expect(panel).toContainText('AP 0.');
  await expect(panel).toContainText('Brier 0.');
  await expect(panel).toContainText('fraud');
  await expect(page.getByTestId('threshold-value')).toHaveText('0.50');

  // A missed fraud costs 10× a false alarm → the optimal cut drops.
  await page.getByLabel('Missed case cost (FN)').fill('10');
  await page.getByTestId('threshold-best').click();
  const chosen = await page.getByTestId('threshold-value').textContent();
  expect(chosen).not.toBe('0.50');
  expect(Number.parseFloat(chosen ?? '1')).toBeLessThan(0.5);
  await expect(page.getByTestId('threshold-metrics')).toContainText('recall');

  // The decision survives the run.
  const history = page.getByTestId('runs-history');
  await history.getByRole('link', { name: 'fraud · status' }).click();
  const artifacts = page.getByTestId('run-artifacts');
  await expect(artifacts).toBeVisible();
  await expect(artifacts).toContainText('Decision threshold');
  await expect(artifacts).toContainText(`= ${chosen}`);
});

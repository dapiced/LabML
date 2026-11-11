import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('iris: prediction sets show the measured coverage, refuse a level too high, and join the run', async ({
  page,
}) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();
  await page.selectOption('#target-select', 'species');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });

  // Inspect a probabilistic model so prediction sets apply.
  await page.getByRole('cell', { name: /Gradient boosting/ }).click();
  const panel = page.getByTestId('conformal-panel');
  await expect(panel).toBeVisible({ timeout: 30000 });
  await expect(panel).toContainText('Gradient boosting');

  // 90 % by default: a coverage measured on the 30 test rows, beside the target.
  await expect(page.getByTestId('conformal-level')).toHaveValue('0.1');
  await expect(page.getByTestId('conformal-coverage')).toContainText('%');
  const summary = page.getByTestId('conformal-summary');
  await expect(summary).toContainText('for a target of 90 %');
  await expect(summary).toContainText('15 rows per half');

  // 95 % needs 19 rows per half and the test split has 15: refused, by the numbers.
  await page.getByTestId('conformal-level').selectOption('0.05');
  await expect(summary).toContainText('No coverage can be promised at 95 %');
  await expect(summary).toContainText('at least 19 rows and has 15');
  await expect(page.getByTestId('conformal-coverage')).toHaveCount(0);

  // Back to a level the split can carry; that answer is the one kept.
  await page.getByTestId('conformal-level').selectOption('0.2');
  await expect(summary).toContainText('for a target of 80 %');

  const history = page.getByTestId('runs-history');
  await history.getByRole('link', { name: 'iris · species' }).click();
  const artifacts = page.getByTestId('run-artifacts');
  await expect(artifacts).toBeVisible();
  await expect(page.getByTestId('artifact-conformal')).toContainText('for a target of 80 %');
});

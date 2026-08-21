import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('energy demo: the lab forecasts a dated series and beats naive honestly', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /energy\.csv/ }).click();
  await expect(page.getByText('240 rows · 3 columns')).toBeVisible();

  const panel = page.getByTestId('forecast');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('rolling-origin backtest');

  await page.getByTestId('forecast-start').click();
  const result = page.getByTestId('forecast-result');
  await expect(result).toBeVisible({ timeout: 30000 });

  // 240 daily points, weekly seasonality detected, a winner with its MAE.
  await expect(result).toContainText('240 points (daily)');
  await expect(result).toContainText('Seasonal period detected: 7');
  await expect(result).toContainText(/winner: .+ with MAE \d/);

  // The methods table ranks the family; Holt-Winters must beat plain naive
  // on this strongly seasonal series.
  const summary = (await result.textContent()) ?? '';
  const winner = /winner: (.+) with MAE ([\d.,]+) \(naive: ([\d.,]+)\)/.exec(summary);
  expect(winner).not.toBeNull();
  expect(Number.parseFloat(winner![2])).toBeLessThan(Number.parseFloat(winner![3]));
  await expect(result.locator('table')).toContainText('Naive (last value)');
  await expect(result).toContainText('empirical 80% interval');
});

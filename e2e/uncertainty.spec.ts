import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('iris: leaderboard metrics carry 95% intervals and a paired verdict', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();
  await page.selectOption('#target-select', 'species');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });

  // The interval panel rides along with every completed run.
  const panel = page.getByTestId('uncertainty-panel');
  await expect(panel).toBeVisible({ timeout: 30000 });
  await expect(panel).toContainText('95% CI · 1,000 resamples');
  await expect(panel).toContainText(/\[0\.\d{3} ; \d\.\d{3}\]/);
  await expect(panel).toContainText('Naive baseline');

  // On iris the winner crushes the majority-class baseline — decisive verdict.
  const verdict = page.getByTestId('uncertainty-verdict');
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText('beats Naive baseline');
  await expect(verdict).toContainText('Probably real');

  // The analysis survives the run.
  const history = page.getByTestId('runs-history');
  await history.getByRole('link', { name: 'iris · species' }).click();
  const artifacts = page.getByTestId('run-artifacts');
  await expect(artifacts).toBeVisible();
  await expect(artifacts).toContainText('How solid are these numbers?');
  await expect(artifacts).toContainText('Probably real');
});

import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('iris: exploration finds groups without a target being set', async ({ page }) => {
  await page.goto('/ml');
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();

  // No target selected — exploration is available anyway.
  const panel = page.getByTestId('explore');
  await expect(panel).toBeVisible();
  await page.getByTestId('explore-start').click();

  const result = page.getByTestId('explore-result');
  await expect(result).toBeVisible({ timeout: 60000 });
  await expect(result).toContainText(/\d groups · silhouette 0\.\d+/);
  await expect(result).toContainText('tried k = 2, 3, 4, 5');

  // As many cluster cards as groups announced, each with distinctive traits.
  const summary = (await result.textContent()) ?? '';
  const k = Number.parseInt(/(\d) groups/.exec(summary)?.[1] ?? '0', 10);
  expect(k).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('cluster-card')).toHaveCount(k);
  await expect(page.getByTestId('cluster-card').first()).toContainText('on average');

  // Deterministic promise is stated to the user.
  await expect(result).toContainText('same seed');
});

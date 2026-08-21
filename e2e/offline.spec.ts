import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('the whole lab works offline after the first visit', async ({ page, context }) => {
  await page.goto('/ml');
  // Wait for the service worker to finish precaching (demo datasets included).
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => Boolean(await caches.match('/datasets/iris.csv')), null, {
    timeout: 30000,
  });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('leaderboard');

  // Full run — parsing, training, insights — with zero network available.
  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();
  await page.selectOption('#target-select', 'species');
  await page.getByTestId('train-button').click();
  await expect(page.getByTestId('train-again')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('leaderboard').locator('tbody tr')).toHaveCount(6);

  await context.setOffline(false);
});

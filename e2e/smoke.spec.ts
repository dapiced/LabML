import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('home page renders and leads to the ML Lab', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/LabML/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('A machine learning lab');
  // The module card is the way in — the hero CTA was removed as redundant.
  await page.getByRole('main').getByRole('link', { name: 'ML Lab', exact: true }).click();
  await expect(page).toHaveURL(/\/ml$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('leaderboard');
});

test('deep link to /ml works (SPA fallback)', async ({ page }) => {
  await page.goto('/ml');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('leaderboard');
});

test('language switcher swaps the interface to French and persists', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Français' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Un laboratoire de machine learning',
  );
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Un laboratoire de machine learning',
  );
});

test('theme toggle reaches dark mode and persists', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Change theme' });
  // system -> light -> dark
  await toggle.click();
  await toggle.click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('unknown routes show the 404 page', async ({ page }) => {
  await page.goto('/nope');
  await expect(page.getByText('404')).toBeVisible();
});

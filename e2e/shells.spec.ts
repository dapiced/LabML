import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

const SHELLS: [string, string][] = [
  ['/ml/', 'From a CSV to a leaderboard'],
  ['/data/', 'Diagnose and clean a dataset'],
  ['/ai/', 'Deep learning, still in your browser.'],
  ['/ai/vision/', 'What does a neural network see?'],
  ['/ai/chat/', 'Ask your data a question.'],
  ['/about/', 'How it works'],
];

test('every section serves a static shell whose hero needs no JavaScript', async ({ request }) => {
  for (const [path, heroText] of SHELLS) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    expect(html, path).toContain(heroText);
    // Self-contained first paint: styles inline, no render-blocking stylesheet.
    expect(html, path).toContain('<style>');
    expect(html, path).not.toContain('rel="stylesheet"');
  }
});

test('the app takes over a shell and client-side navigation still works', async ({ page }) => {
  await page.goto('/data/');
  // Shell hero first, then the live app (demo picker) replaces it seamlessly.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Diagnose and clean');
  await expect(page.getByRole('button', { name: /cafe-sales\.csv/ })).toBeVisible();

  await page.getByRole('link', { name: 'ML Lab' }).click();
  await expect(page).toHaveURL(/\/ml$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('From a CSV');
});

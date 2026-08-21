import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

async function expectNoViolations(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
}

test('home page passes WCAG A/AA checks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoViolations(page);
});

test('about page passes WCAG A/AA checks', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoViolations(page);
});

test('ai hub and vision playground pass WCAG A/AA checks', async ({ page }) => {
  await page.goto('/ai');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoViolations(page);

  await page.goto('/ai/vision');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoViolations(page);
});

test('ml lab passes WCAG A/AA checks, idle and with data loaded', async ({ page }) => {
  await page.goto('/ml');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoViolations(page);

  await page.getByRole('button', { name: /iris\.csv/ }).click();
  await expect(page.getByText('150 rows · 5 columns')).toBeVisible();
  await page.selectOption('#target-select', 'species');
  await expect(page.getByTestId('task-badge')).toBeVisible();
  await expectNoViolations(page);
});

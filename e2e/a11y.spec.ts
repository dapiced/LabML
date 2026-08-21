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

test('data assistant passes WCAG A/AA checks, idle and mid-conversation', async ({ page }) => {
  await page.goto('/ai/chat');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoViolations(page);

  await page.getByRole('button', { name: /titanic\.csv/ }).click();
  await expect(page.getByText('891 rows · 15 columns')).toBeVisible();
  await page.getByLabel('Your question').fill('average age by pclass');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByTestId('chat-assistant').last()).toContainText('average', {
    timeout: 15000,
  });
  await expectNoViolations(page);
});

test('data studio passes WCAG A/AA checks, idle and with the demo audited', async ({ page }) => {
  await page.goto('/data');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoViolations(page);

  await page.getByRole('button', { name: /cafe-sales\.csv/ }).click();
  await expect(page.getByTestId('recipe-result')).toBeVisible();
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

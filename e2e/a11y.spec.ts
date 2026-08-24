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

test('privacy page passes WCAG A/AA checks', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoViolations(page);
  // The live audit renders numbers and a verdict — check it too, with content.
  await page.getByTestId('privacy-audit-run').click();
  await expect(page.getByTestId('privacy-audit-result')).toBeVisible();
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

/**
 * V35 — the documentation had never been in this file.
 *
 * a11y.spec.ts was written at V4 and grown one page at a time; V32–V34 added
 * twenty-four documentation pages and none of them was ever versed into it.
 * The audit found the consequence with axe: six scrollable tables on
 * /docs/refus that no keyboard could enter — `scrollable-region-focusable`,
 * WCAG 2.1.1, level A. Checking one page would have caught it; checking every
 * page is what stops the next one.
 */
test('the docs index and every page pass WCAG A/AA checks', async ({ page }) => {
  await page.goto('/docs');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoViolations(page);

  // Read the slugs off the index rather than the filesystem: a page that is
  // built but unreachable is a different bug, and this suite should follow
  // the links a visitor can actually click.
  const slugs = await page
    .locator('a[href^="/docs/"]')
    .evaluateAll((links) => [
      ...new Set(links.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? '')),
    ]);
  expect(slugs.length, 'the index links to no doc page').toBeGreaterThan(0);

  for (const href of slugs) {
    await page.goto(href);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoViolations(page);
  }
});

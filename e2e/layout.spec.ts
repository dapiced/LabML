/**
 * V35 — no page may scroll sideways, at any viewport the projects declare.
 *
 * The V35 audit measured in a real browser what no existing test could see: at
 * 375 px, six of the twelve doc pages scrolled the WHOLE PAGE sideways — +409 px
 * on four of them — with the body text cut off at the right edge and nothing to
 * tell the reader to scroll. The cause was one decision, `overflow-x` sitting on
 * the `<table>` itself. The reason it shipped is that `playwright.config.ts`
 * declared a single project, Desktop Chrome: every e2e test in this repository
 * ran at 1280 px, in light mode, and had done since V4.
 *
 * So this file deliberately does NOT pin a viewport. It inherits whichever the
 * running project supplies, and the config now supplies two — desktop and a
 * phone. A regression at either width fails here.
 *
 * One test does pin its own, and says why: proving that a wide table scrolls
 * *inside its region* only means something at a width where the table is
 * actually wider than the column.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/** Slugs read from the front matter — the URL a reader actually visits. */
const SLUGS = readdirSync('src/content/docs/fr')
  .map((file) => /^slug:\s*(\S+)/m.exec(readFileSync(`src/content/docs/fr/${file}`, 'utf8'))?.[1])
  .filter((slug): slug is string => Boolean(slug))
  .sort();

/** Every route a visitor can reach without loading a file first. */
const ROUTES = [
  '/',
  '/ml',
  '/data',
  '/ai',
  '/ai/vision',
  '/ai/chat',
  '/docs',
  '/about',
  '/privacy',
  '/route-qui-nexiste-pas',
  ...SLUGS.map((slug) => `/docs/${slug}`),
];

test('no page scrolls the viewport sideways', async ({ page }) => {
  const overflowing: string[] = [];
  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // Named, not counted: a failure should say WHICH page and by how much.
    if (overflow > 0) overflowing.push(`${route} +${overflow}px`);
  }
  expect(overflowing, 'these pages scroll the viewport sideways').toEqual([]);
});

test.describe('a table too wide for the column', () => {
  // Pinned on purpose: at desktop width no doc table is wider than the prose
  // column, so the mechanism under test would not be exercised at all.
  test.use({ viewport: { width: 375, height: 812 } });

  test('scrolls inside its own region, which the keyboard can reach', async ({ page }) => {
    await page.goto('/docs/refus');
    const regions = page.locator('.doc-prose .doc-table');
    await expect(regions.first()).toBeVisible();
    const count = await regions.count();
    expect(count).toBeGreaterThan(0);

    let scrollable = 0;
    for (let i = 0; i < count; i++) {
      const region = regions.nth(i);
      // Focusable and named, or a keyboard user cannot read past the fold —
      // this is the axe rule `scrollable-region-focusable`, WCAG 2.1.1.
      await expect(region).toHaveAttribute('tabindex', '0');
      await expect(region).toHaveAttribute('role', 'region');
      expect((await region.getAttribute('aria-label'))?.trim()).toBeTruthy();
      // A real table underneath — `display: block` on a table drops its
      // row/column semantics for a screen reader.
      await expect(region.locator('table')).toHaveCount(1);
      if (await region.evaluate((el) => el.scrollWidth > el.clientWidth)) scrollable++;
    }
    // At least one table really is wider than the phone: that is the case the
    // whole mechanism exists for. If none were, this page would prove nothing,
    // and a « fix » that squashed or hid the table would pass unnoticed.
    expect(scrollable, 'no table on /docs/refus is actually wider than 375 px').toBeGreaterThan(0);

    const wide = regions.filter({ has: page.locator('table') }).first();
    await wide.evaluate((el: HTMLElement) => el.focus());
    await expect(wide).toBeFocused();
  });
});

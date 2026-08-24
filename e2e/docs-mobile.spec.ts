/**
 * V35 — the documentation on a phone.
 *
 * The V35 audit measured this in a real browser and found what no existing
 * test could see: at 375 px, six of the twelve doc pages scrolled the WHOLE
 * PAGE sideways — +409 px on four of them — and the body text was cut off at
 * the right edge with nothing telling the reader to scroll. The cause was one
 * decision, `overflow-x` sitting on the `<table>` itself, and the reason it
 * shipped is that `playwright.config.ts` declares a single project, Desktop
 * Chrome. Every e2e test in this repository ran at 1280 px. This file is the
 * viewport that was missing.
 *
 * It asserts two things, and the second matters as much as the first: the page
 * must not scroll, AND the table must still be reachable. A « fix » that
 * squashes the table into the column, or hides it, also makes the page stop
 * overflowing — and loses the content. So the region is checked to be a real
 * scroll container, focusable, and named.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// A phone, not a « small desktop »: 375 px is the iPhone SE/12 mini class and
// the narrowest viewport worth supporting.
test.use({ viewport: { width: 375, height: 812 } });

/** Slugs read from the front matter — the URL a reader actually visits. */
const SLUGS = readdirSync('src/content/docs/fr')
  .map((file) => /^slug:\s*(\S+)/m.exec(readFileSync(`src/content/docs/fr/${file}`, 'utf8'))?.[1])
  .filter((slug): slug is string => Boolean(slug))
  .sort();

test('the doc index and every page fit a 375 px screen', async ({ page }) => {
  const overflowing: string[] = [];
  for (const route of ['/docs', ...SLUGS.map((slug) => `/docs/${slug}`)]) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 0) overflowing.push(`${route} +${overflow}px`);
  }
  // Named, not counted: a failure should say WHICH page and by how much.
  expect(overflowing, 'these pages scroll the viewport sideways').toEqual([]);
});

test('a wide table scrolls inside its own region, which the keyboard can reach', async ({
  page,
}) => {
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
  // whole mechanism exists for. If none were, this page would prove nothing.
  expect(scrollable, 'no table on /docs/refus is actually wider than 375 px').toBeGreaterThan(0);

  // And the scroll works: focus the region, press End, the content moves.
  const wide = regions.filter({ has: page.locator('table') }).first();
  await wide.evaluate((el: HTMLElement) => el.focus());
  await expect(wide).toBeFocused();
});

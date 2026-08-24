import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

const SHELLS: [string, string][] = [
  ['/ml/', 'From a CSV to a leaderboard'],
  ['/data/', 'Diagnose and clean a dataset'],
  ['/ai/', 'Deep learning, still in your browser.'],
  ['/ai/vision/', 'What does a neural network see?'],
  ['/ai/chat/', 'Ask your data a question.'],
  ['/about/', 'How it works'],
  ['/privacy/', 'Your data never leaves your browser'],
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

/**
 * V35 — the metadata each shell carries.
 *
 * The audit measured nine prerendered shells sharing one `<title>LabML</title>`
 * and one description, with no canonical, no Open Graph and no Twitter card:
 * a LabML link pasted into LinkedIn or Slack showed no preview at all, three
 * open tabs were indistinguishable, and a crawler saw nine identical titles.
 * Lighthouse scored SEO 100 throughout — its category audits none of this,
 * which is exactly why the gap survived so long and why the guard belongs here.
 */
test('every shell carries its own title, description and social card', async ({ request }) => {
  const seen = new Map<string, string>();
  for (const [path] of [['/'], ...SHELLS] as [string][]) {
    const html = await (await request.get(path)).text();
    const meta = (pattern: RegExp) => pattern.exec(html)?.[1]?.trim() ?? '';

    const title = meta(/<title>([^<]*)<\/title>/);
    expect(title, `${path} has no title`).toBeTruthy();
    expect(title, `${path} is titled with the product name alone`).not.toBe('LabML');
    // The defect itself: two pages must never answer with the same title.
    expect(seen.has(title), `${path} repeats the title of ${seen.get(title)}`).toBe(false);
    seen.set(title, path);

    const description = meta(/<meta name="description" content="([^"]*)"/);
    expect(description.length, `${path} has no description`).toBeGreaterThan(40);

    expect(meta(/<link rel="canonical" href="([^"]*)"/), `${path} canonical`).toBe(
      `https://app.dominicdapice.com${path}`,
    );
    expect(meta(/<meta property="og:url" content="([^"]*)"/), `${path} og:url`).toBe(
      `https://app.dominicdapice.com${path}`,
    );
    expect(meta(/<meta property="og:title" content="([^"]*)"/), `${path} og:title`).toBe(title);
    expect(meta(/<meta name="twitter:card" content="([^"]*)"/), `${path} twitter:card`).toBe(
      'summary_large_image',
    );
    // A card that points at a missing image is a card that renders blank.
    const image = meta(/<meta property="og:image" content="([^"]*)"/);
    expect(image, `${path} og:image`).toBe('https://app.dominicdapice.com/og.png');
  }

  const og = await request.get('/og.png');
  expect(og.status(), 'the social image is not served').toBe(200);
  expect(og.headers()['content-type']).toContain('image/png');
});

test('the sitemap lists every page that exists, and nothing that does not', async ({ request }) => {
  const xml = await (await request.get('/sitemap.xml')).text();
  const listed = [...xml.matchAll(/<loc>https:\/\/app\.dominicdapice\.com([^<]*)<\/loc>/g)].map(
    (match) => match[1],
  );

  for (const [path] of [['/'], ...SHELLS] as [string][]) {
    expect(listed, `${path} is missing from the sitemap`).toContain(path);
  }
  // Documentation pages are the ones a hand-written sitemap would forget:
  // twelve slugs, each added by dropping a Markdown file into the repository.
  const docs = listed.filter((path) => path.startsWith('/docs/'));
  expect(docs.length, 'the sitemap advertises no documentation page').toBeGreaterThanOrEqual(12);

  // Every advertised URL must actually answer — a sitemap of 404s is worse
  // than no sitemap, and this is the direction that catches a removed page.
  for (const path of listed) {
    expect((await request.get(path)).status(), `${path} is advertised but does not answer`).toBe(
      200,
    );
  }

  // Nothing that describes one visitor's local data belongs in a crawler's map.
  for (const path of listed) {
    expect(path, 'a dynamic route leaked into the sitemap').not.toMatch(
      /\/ml\/(run|share|compare)/,
    );
  }

  expect(await (await request.get('/robots.txt')).text()).toContain(
    'Sitemap: https://app.dominicdapice.com/sitemap.xml',
  );
});

/**
 * The Bing Webmaster Tools verification file.
 *
 * Bing fetches `/BingSiteAuth.xml` and reads the token inside to confirm the
 * site is ours. If the file ever stops being served — a `public/` reshuffle, a
 * build change — verification lapses and the site quietly drops out of Bing's
 * index. There is no error and no visible symptom, which is exactly why this
 * belongs in a test rather than in someone's memory.
 *
 * The check is on the CONTENT, never the status code: `_redirects` sends every
 * unknown path to `index.html` with HTTP 200, so a missing file still answers
 * 200 — with HTML. That trap cost a false positive during the V35 audit.
 */
test('the Bing site verification file is served from the root', async ({ request }) => {
  const response = await request.get('/BingSiteAuth.xml');
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body, 'the SPA fallback answered instead of the file').not.toContain('<!doctype html>');
  expect(body).toContain('<users>');
  // The token itself: a different one verifies a different property.
  expect(body).toContain('B32D3D73A3D7BB4EA0AD1FDC8EF23279');
});

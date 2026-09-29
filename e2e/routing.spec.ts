import { expect, test } from '@playwright/test';

/**
 * V41 — what Cloudflare Pages does with a URL, checked against Pages' own
 * routing rather than the dev server's.
 *
 * `vite preview` answers every unknown path with `index.html` and a 200, and
 * ignores `_redirects`, `_headers` and `404.html` — so nothing in the rest of
 * the suite could tell a real 404 from a soft one. This spec runs in the
 * `pages` project only, against `wrangler pages dev dist`, which applies the
 * same asset routing production does.
 *
 * Measured on production before V41: every misspelled address answered 200,
 * and the file's one rule (`/* /index.html 200`) was silently INVALID — Pages
 * strips `/index.html` from URLs, so the rewrite would loop and the parser
 * dropped it. The 200 came from the default single-page fallback instead.
 */
test.use({ locale: 'en-US' });

test('an unknown address answers 404 with the not-found page, not indexed', async ({ request }) => {
  const response = await request.get('/this-address-does-not-exist');
  expect(response.status()).toBe(404);
  const html = await response.text();
  expect(html).toContain('<title>Page not found · LabML</title>');
  expect(html).toContain('<meta name="robots" content="noindex">');
  // A 404 has no canonical: there is nothing there to be the canonical of.
  expect(html).not.toContain('rel="canonical"');
});

test('a misspelled documentation slug answers 404 too', async ({ request }) => {
  expect((await request.get('/docs/this-page-does-not-exist')).status()).toBe(404);
});

test('a missing asset answers 404, never HTML with a 200', async ({ request }) => {
  const response = await request.get('/assets/this-chunk-does-not-exist.js');
  expect(response.status()).toBe(404);
});

test('a run, a comparison and a share link answer 200 with the bare shell', async ({ request }) => {
  for (const path of ['/ml/run/abc', '/ml/compare/a/b', '/ml/compare-many/a,b,c', '/ml/share']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    // No hero: these pages describe one visitor's local data and the app
    // paints them; a hero would show the wrong content for a frame.
    expect(html, path).not.toMatch(/<h1[\s>]/);
    expect(html, path).toContain('<meta name="robots" content="noindex">');
    // Previews still work — a share link pasted in a chat shows the site card.
    expect(html, path).toContain('<meta property="og:image"');
    expect(html, path).toContain('<div id="root"></div>');
  }
});

test('the home page, a section and a documentation page answer 200 with their hero', async ({
  request,
}) => {
  const pages: [string, string][] = [
    ['/', 'A machine learning lab,'],
    ['/ml/', 'From a CSV to a leaderboard'],
    [
      '/docs/premier-modele',
      'rel="canonical" href="https://app.dominicdapice.com/docs/premier-modele"',
    ],
  ];
  for (const [path, text] of pages) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    expect(html, path).toContain(text);
    expect(html, path).toMatch(/<h1[\s>]/);
  }
});

test('the security headers are served by the asset routing, not only declared', async ({
  request,
}) => {
  const headers = (await request.get('/')).headers();
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['x-frame-options']).toBe('DENY');
});

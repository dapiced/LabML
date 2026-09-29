import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * V41 — `public/_redirects` and `src/app/router.tsx` describe the same routes,
 * from two sides. The router says which paths the app answers; the redirects
 * file says which of them Cloudflare Pages must hand to the app because no
 * static file exists for them (a run, a comparison, a share link). A route
 * added to one and not the other is a page that renders in the dev server and
 * answers 404 in production — the kind of gap nothing else would report.
 *
 * Until V41 the file held `/* /index.html 200`, which `wrangler pages dev`
 * reports as an INVALID rule (Pages strips `/index.html`, so the rewrite loops
 * and is ignored): the 200 on unknown URLs came from the default SPA fallback,
 * and every misspelled address was a soft 404. A `404.html` now takes that
 * role with the right status, so the rewrite list must be exact.
 */
const redirects = readFileSync('public/_redirects', 'utf8');
const router = readFileSync('src/app/router.tsx', 'utf8');
const viteConfig = readFileSync('vite.config.ts', 'utf8');

const rules = redirects
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'))
  .map((line) => {
    const [source, destination, status] = line.split(/\s+/);
    return { source, destination, status };
  });

/** Every `path: '…'` the router declares, as written. */
const routerPaths = [...router.matchAll(/path: '([^']+)'/g)].map((match) => match[1]);
/** Every section with a prerendered shell (`dir: '…'` in vite.config.ts). */
const shellDirs = [...viteConfig.matchAll(/\bdir: '([^']+)'/g)].map((match) => match[1]);

/** `ml/run/:id` → `/ml/run/*`, `ml/share` → `/ml/share`. */
function toSource(path: string): string {
  const param = path.indexOf(':');
  return `/${param === -1 ? path : `${path.slice(0, param)}*`}`;
}

describe('_redirects', () => {
  it('has no catch-all: unknown addresses must reach 404.html with a 404', () => {
    expect(rules.map((rule) => rule.source)).not.toContain('/*');
  });

  it('rewrites every app route that has no static file, and nothing else', () => {
    const expected = routerPaths
      .filter((path) => path !== '/' && path !== '*')
      // Sections with a shell and doc pages are exact files on disk.
      .filter((path) => !shellDirs.includes(path) && !path.startsWith('docs'))
      .map(toSource)
      .sort();
    expect(rules.map((rule) => rule.source).sort()).toEqual(expected);
    expect(expected.length).toBeGreaterThanOrEqual(4);
  });

  it('serves the bare shell at its clean URL, with a 200, for each of them', () => {
    for (const rule of rules) {
      // `/shell.html` would be answered with a 308 to `/shell` — the very
      // loop that made the old rule invalid. The clean URL is the asset.
      expect(rule.destination, rule.source).toBe('/shell');
      expect(rule.status, rule.source).toBe('200');
    }
  });

  it('lists exact sources before splats, as the Pages parser recommends', () => {
    const firstSplat = rules.findIndex((rule) => rule.source.includes('*'));
    const lastExact = rules.map((rule) => rule.source.includes('*')).lastIndexOf(false);
    expect(lastExact).toBeLessThan(firstSplat);
  });
});

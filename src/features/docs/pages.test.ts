import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOC_KINDS, compileDoc, type DocPage } from './compile';

const ROOT = 'src/content/docs';

function pages(): { path: string; raw: string; doc: DocPage }[] {
  const out: { path: string; raw: string; doc: DocPage }[] = [];
  for (const lang of readdirSync(ROOT)) {
    for (const file of readdirSync(`${ROOT}/${lang}`)) {
      const path = `${ROOT}/${lang}/${file}`;
      const raw = readFileSync(path, 'utf8');
      out.push({ path, raw, doc: compileDoc(raw, lang, path) });
    }
  }
  return out;
}

const NEXT_HEADING = /^## (Et ensuite ?\?|Where to go next)\s*$/m;

describe('every documentation page', () => {
  const all = pages();

  it('compiles', () => {
    expect(all.length).toBeGreaterThan(10);
  });

  it.each(all.map((page) => page.path))('ends with a next step — %s', (path) => {
    // V34: « documentation without a next step is a dead end ». A reader who
    // finishes a page and finds nothing to do next leaves; that is the whole
    // reason this is a test and not a habit.
    const { raw } = all.find((page) => page.path === path)!;
    expect(raw, `${path} has no « Et ensuite ? » / « Where to go next » section`).toMatch(
      NEXT_HEADING,
    );
    const after = raw.slice(raw.search(NEXT_HEADING));
    expect(after, `${path}'s next step offers no link`).toMatch(/\]\(\/(docs|ml|data|ai|privacy)/);
  });

  it.each(all.map((page) => page.path))('declares a Diátaxis quadrant — %s', (path) => {
    const { doc } = all.find((page) => page.path === path)!;
    expect(DOC_KINDS).toContain(doc.kind);
  });

  it('pairs every slug across both languages', () => {
    // A slug present in one language only means a reader switching language
    // lands on a « page does not exist » — the silent kind of broken link.
    const bySlug = new Map<string, Set<string>>();
    for (const { doc } of all) {
      if (!bySlug.has(doc.slug)) bySlug.set(doc.slug, new Set());
      bySlug.get(doc.slug)!.add(doc.lang);
    }
    for (const [slug, langs] of bySlug) {
      expect([...langs].sort(), `slug ${slug} exists in ${[...langs]} only`).toEqual(['en', 'fr']);
    }
  });

  it('links only to slugs that exist', () => {
    const slugs = new Set(all.map((page) => page.doc.slug));
    for (const { path, raw } of all) {
      for (const match of raw.matchAll(/\]\(\/docs\/([a-z0-9-]+)\)/g)) {
        expect(slugs, `${path} links to /docs/${match[1]}, which does not exist`).toContain(
          match[1],
        );
      }
    }
  });

  it('offers each Diátaxis quadrant except the one deliberately absent', () => {
    const kinds = new Set(all.map((page) => page.doc.kind));
    expect(kinds).toContain('tutorial');
    expect(kinds).toContain('how-to');
    expect(kinds).toContain('reference');
    expect(kinds).toContain('explanation');
  });
});

describe('the limits page', () => {
  const plan = readFileSync('PLAN.md', 'utf8');
  const LIMITS = ['src/content/docs/fr/limites.md', 'src/content/docs/en/limits.md'] as const;

  /**
   * V34 — the limits are extracted from `PLAN.md`, not remembered. Each claim
   * below is checked against the engineering log that recorded it, so the page
   * cannot keep asserting a renunciation that was later reversed — which has
   * already happened once: class weighting was descoped by name in V16 and
   * delivered in V36.
   */
  const TRACEABLE: { claim: string; inPlan: RegExp }[] = [
    { claim: '1.43', inPlan: /1\.43 GB.*?(?:measures?|scores?) \*\*worse\*\*|Qwen3-1\.7B/s },
    { claim: '190', inPlan: /CLIP ViT-B\/32 \(~190 MB\)/ },
    { claim: '35', inPlan: /YOLOX-S \(~35 MB\)/ },
    { claim: '0.792', inPlan: /the real champion figure is \*\*0\.792\*\*/ },
    { claim: '18.5', inPlan: /they weigh \*\*18\.5\*\*/ },
  ];

  it.each(TRACEABLE)('traces « $claim » back to PLAN.md', ({ inPlan }) => {
    expect(plan).toMatch(inPlan);
  });

  it.each(LIMITS)('states each traceable figure — %s', (path) => {
    const text = readFileSync(path, 'utf8');
    for (const { claim } of TRACEABLE) {
      // French writes « 1,43 » where English writes « 1.43 ». The first version
      // of this guard demanded the English form in both files and failed on the
      // French page — a defect in the check, not in the page. Accepting either
      // separator is the fix; accepting any character between the digits would
      // not be.
      const either = new RegExp(claim.replace('.', '[.,]'));
      expect(text, `${path} does not state ${claim}`).toMatch(either);
    }
  });

  it.each(LIMITS)('separates the three kinds of limit — %s', (path) => {
    const text = readFileSync(path, 'utf8');
    // Conflating a design choice with a measured drop is the flattering
    // version of this page; the headings are what keep them apart.
    expect(text).toMatch(/^## (Ce qui a été écarté par choix|Set aside by choice)$/m);
    expect(text).toMatch(/^## (Ce qui a été abandonné après mesure|Dropped after measurement)$/m);
    expect(text).toMatch(
      /^## (Des prédictions que la mesure a démenties|Predictions measurement refuted)$/m,
    );
  });
});

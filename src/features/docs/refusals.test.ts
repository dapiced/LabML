import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REFUSALS, visitorRefusals } from './refusals';

/**
 * Walk the shipped source. Tests are excluded on purpose: a code thrown only by
 * a test (`constrained-decoding-unavailable` in the LLM bench,
 * `header-not-served` in the privacy policy test) can never reach a visitor,
 * and listing it would pad the public table with rows nobody can encounter.
 */
function shippedFiles(dir = 'src'): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...shippedFiles(path));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/** Every `throw new Error('some-kebab-code'…)` the shipped app can raise. */
function thrownCodes(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of shippedFiles()) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(
      /throw new Error\(\s*[`'"]([a-z][a-z0-9]*(?:-[a-z0-9]+)+)/g,
    )) {
      if (!found.has(match[1])) found.set(match[1], file);
    }
  }
  return found;
}

describe('the refusal catalogue', () => {
  it('lists every code the shipped app throws — nothing undocumented', () => {
    const thrown = [...thrownCodes().keys()].sort();
    const listed = REFUSALS.map((refusal) => refusal.code).sort();
    const missing = thrown.filter((code) => !listed.includes(code));
    expect(
      missing,
      `thrown but absent from REFUSALS (and therefore from /docs): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('lists no code the app no longer throws — nothing stale', () => {
    const thrown = [...thrownCodes().keys()];
    const stale = REFUSALS.map((r) => r.code).filter((code) => !thrown.includes(code));
    expect(stale, `listed in REFUSALS but never thrown any more: ${stale.join(', ')}`).toEqual([]);
  });

  it('has no duplicate code', () => {
    const codes = REFUSALS.map((refusal) => refusal.code);
    expect(codes).toHaveLength(new Set(codes).size);
  });

  it('keeps a real public table — visitor rows are the majority of the point', () => {
    expect(visitorRefusals().length).toBeGreaterThan(15);
  });

  it('names, for each area, at least one refusal a visitor can meet', () => {
    // A whole area whose refusals are all « internal » would mean either the
    // area never refuses (unlikely) or its refusals are undecodable (the defect
    // this wave exists to remove).
    for (const area of ['ml', 'import', 'data', 'chat', 'llm'] as const) {
      expect(
        visitorRefusals().some((refusal) => refusal.area === area),
        `area ${area} has no visitor-facing refusal`,
      ).toBe(true);
    }
  });
});

/**
 * The catalogue is the machine-checkable half; this is the other one. A code
 * can be listed in `refusals.ts` and still be undocumented — and a page can
 * name a code that no longer exists. Both directions fail here, in both
 * languages, so the public table stays a description of the software rather
 * than a description of what it once did.
 */
describe('the /docs refusals page', () => {
  const PAGES = ['src/content/docs/fr/refus.md', 'src/content/docs/en/refusals.md'] as const;

  it.each(PAGES)('documents every visitor-facing refusal — %s', (page) => {
    const text = readFileSync(page, 'utf8');
    const undocumented = visitorRefusals()
      .map((refusal) => refusal.code)
      .filter((code) => !text.includes(code));
    expect(undocumented, `absent from ${page}: ${undocumented.join(', ')}`).toEqual([]);
  });

  it.each(PAGES)('names no refusal that does not exist — %s', (page) => {
    const text = readFileSync(page, 'utf8');
    const known = new Set([
      ...REFUSALS.map((refusal) => refusal.code),
      // Named in the page as guards that are deliberately NOT refusals: they
      // are set as an outcome, never thrown, and the reader is told why.
      'not-parallelisable',
      'not-serialisable',
      // Carries a `:rows:cols` detail, so it is a prefix rather than a throw.
      'too-large',
    ]);
    const invented = [...text.matchAll(/`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g)]
      .map((match) => match[1])
      .filter((code) => !known.has(code));
    expect(invented, `named in ${page} but unknown to the code: ${invented.join(', ')}`).toEqual(
      [],
    );
  });

  it('documents each internal refusal too, so an unexpected one can be looked up', () => {
    const internal = REFUSALS.filter((refusal) => refusal.audience === 'internal');
    for (const page of PAGES) {
      const text = readFileSync(page, 'utf8');
      for (const refusal of internal) {
        expect(text, `${page} does not mention ${refusal.code}`).toContain(refusal.code);
      }
    }
  });
});

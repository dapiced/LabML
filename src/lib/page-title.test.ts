import fr from '@/locales/fr.json';
import en from '@/locales/en.json';
import { describe, expect, it } from 'vitest';
import { formatTitle, titleKeyFor } from './page-title';

describe('titleKeyFor', () => {
  it.each([
    ['/', 'home'],
    ['/ml', 'ml'],
    ['/data', 'data'],
    ['/ai', 'ai'],
    ['/about', 'about'],
    ['/privacy', 'privacy'],
    ['/docs', 'docs'],
  ])('names %s', (path, key) => {
    expect(titleKeyFor(path)).toBe(key);
  });

  it('prefers the longer match — /ai/vision is not the AI hub', () => {
    expect(titleKeyFor('/ai/vision')).toBe('aiVision');
    expect(titleKeyFor('/ai/chat')).toBe('aiChat');
  });

  it.each([
    ['/ml/run/abc123', 'run'],
    ['/ml/compare/a/b', 'compare'],
    ['/ml/compare-many/a,b,c', 'compare'],
    ['/ml/share', 'share'],
  ])('names the dynamic route %s', (path, key) => {
    expect(titleKeyFor(path)).toBe(key);
  });

  it('lets a documentation page name itself', () => {
    // Twenty-four pages, twenty-four names. A generic « Documentation » here
    // would be an improvement on `LabML` and still the wrong title.
    expect(titleKeyFor('/docs/methode')).toBeNull();
    expect(titleKeyFor('/docs/refus')).toBeNull();
  });

  it('falls back to the not-found title for a route nothing serves', () => {
    expect(titleKeyFor('/nope')).toBe('notFound');
    expect(titleKeyFor('/ml/nope/deeper')).toBe('notFound');
  });

  it('ignores a trailing slash — Cloudflare serves /ml/ and /ml alike', () => {
    expect(titleKeyFor('/ml/')).toBe('ml');
    expect(titleKeyFor('/')).toBe('home');
  });
});

describe('formatTitle', () => {
  it('appends the product name', () => {
    expect(formatTitle('ML Lab', 'LabML')).toBe('ML Lab · LabML');
  });

  it('does not repeat a product name the page title already carries', () => {
    expect(formatTitle('LabML — machine learning in your browser', 'LabML')).toBe(
      'LabML — machine learning in your browser',
    );
  });
});

describe('the two locales', () => {
  /** Every key the mapping can return, so neither language can be short one. */
  const KEYS = [
    'home',
    'ml',
    'data',
    'ai',
    'aiVision',
    'aiChat',
    'about',
    'privacy',
    'docs',
    'notFound',
    'run',
    'compare',
    'share',
    'suffix',
  ];

  it.each(['fr', 'en'])('%s carries a title for every route the mapping names', (lang) => {
    const titles = (lang === 'fr' ? fr : en).common.pageTitles as Record<string, string>;
    for (const key of KEYS) {
      expect(titles[key], `common.pageTitles.${key} missing in ${lang}.json`).toBeTruthy();
    }
    expect(Object.keys(titles).sort()).toEqual([...KEYS].sort());
  });

  it('gives every route a title that is not just the product name', () => {
    // The defect this whole mapping exists to fix: nine routes, one title.
    const seen = new Set<string>();
    const titles = en.common.pageTitles as Record<string, string>;
    for (const key of KEYS.filter((k) => k !== 'suffix')) {
      const title = formatTitle(titles[key], titles.suffix);
      expect(title, `${key} is titled with the product name alone`).not.toBe(titles.suffix);
      expect(seen.has(title), `${key} repeats a title already used`).toBe(false);
      seen.add(title);
    }
  });
});

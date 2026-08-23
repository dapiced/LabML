import { describe, expect, it } from 'vitest';
import type { DocPage } from './compile';
import { fold } from './compile';
import { searchDocs } from './search';

const page = (slug: string, title: string, body: string, order = 1): DocPage => ({
  slug,
  lang: 'fr',
  kind: 'tutorial',
  order,
  title,
  summary: '',
  html: `<p>${body}</p>`,
  headings: [],
  searchText: fold(`${title} ${body}`),
});

const CORPUS = [
  page('a', 'Votre premier modèle', 'Charger titanic puis entraîner le modèle.', 1),
  page('b', 'Lire un classement', 'Le champion est élu sur la validation.', 2),
  page('c', 'Confidentialité', 'Rien ne quitte le navigateur, jamais.', 3),
];

describe('searchDocs', () => {
  it('finds a page by a word in its body', () => {
    expect(searchDocs(CORPUS, 'titanic').map((h) => h.page.slug)).toEqual(['a']);
  });

  it('matches without accents — the common French keyboard case', () => {
    expect(searchDocs(CORPUS, 'modele').map((h) => h.page.slug)).toEqual(['a']);
    expect(searchDocs(CORPUS, 'MODÈLE').map((h) => h.page.slug)).toEqual(['a']);
  });

  it('requires every word, so a longer query never returns more', () => {
    expect(searchDocs(CORPUS, 'charger titanic')).toHaveLength(1);
    // « validation » is on page b, « titanic » on page a: nothing holds both.
    expect(searchDocs(CORPUS, 'titanic validation')).toHaveLength(0);
  });

  it('ranks a title hit above a body hit', () => {
    const corpus = [
      page('body', 'Autre chose', 'On y parle de confidentialité en passant.', 1),
      page('title', 'Confidentialité', 'Le sujet de la page.', 2),
    ];
    expect(searchDocs(corpus, 'confidentialite').map((h) => h.page.slug)).toEqual([
      'title',
      'body',
    ]);
  });

  it('returns nothing for an empty or blank query rather than everything', () => {
    expect(searchDocs(CORPUS, '')).toEqual([]);
    expect(searchDocs(CORPUS, '   ')).toEqual([]);
  });

  it('returns an excerpt carrying the match', () => {
    const [hit] = searchDocs(CORPUS, 'titanic');
    expect(hit.excerpt).toContain('titanic');
    expect(hit.matched).toEqual(['titanic']);
  });
});

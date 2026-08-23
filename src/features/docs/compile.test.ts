import { describe, expect, it } from 'vitest';
import { compileDoc, fold, headingId, renderTryBlocks, splitFrontMatter, textOf } from './compile';

const page = (front: string, body: string) => `---\n${front}\n---\n${body}`;
const VALID = 'slug: first-model\nkind: tutorial\norder: 1\ntitle: Titre\nsummary: Résumé';

describe('splitFrontMatter', () => {
  it('reads flat key: value pairs and returns the body untouched', () => {
    const { data, body } = splitFrontMatter(page('slug: a\ntitle: B', '# Corps\n'));
    expect(data).toEqual({ slug: 'a', title: 'B' });
    expect(body).toBe('# Corps\n');
  });

  it('strips surrounding quotes so a title with a colon is writable', () => {
    expect(splitFrontMatter(page('title: "A: B"', '')).data.title).toBe('A: B');
  });

  it('refuses a file with no front matter at all', () => {
    expect(() => splitFrontMatter('# Just a heading')).toThrow(/front matter missing/);
  });

  it('refuses a line that is not `key: value` instead of ignoring it', () => {
    // Silently skipping it would drop a real field and ship a page missing
    // its title, which is exactly the quiet failure this wave is against.
    expect(() => splitFrontMatter(page('slug: a\nthis is not a pair', ''))).toThrow(/not a/);
  });
});

describe('fold', () => {
  it('folds accents and case, so « modele » finds « Modèle »', () => {
    expect(fold('Modèle')).toBe('modele');
    expect(fold('DÉJÀ VU')).toBe('deja vu');
  });
});

describe('headingId', () => {
  it('builds a stable, guessable anchor', () => {
    expect(headingId('Premier modèle en 10 minutes')).toBe('premier-modele-en-10-minutes');
  });

  it('never returns an empty id', () => {
    expect(headingId('———')).toBe('section');
  });
});

describe('renderTryBlocks', () => {
  it('turns a :::try line into a link that does the thing', () => {
    const html = renderTryBlocks(':::try /ml?demo=titanic | Ouvrir le ML Lab');
    expect(html).toContain('href="/ml?demo=titanic"');
    expect(html).toContain('data-doc-try="/ml?demo=titanic"');
    expect(html).toContain('Ouvrir le ML Lab');
  });

  it('escapes the label rather than letting a page inject markup', () => {
    expect(renderTryBlocks(':::try /ml | <img src=x>')).toContain('&lt;img src=x&gt;');
  });

  it('leaves ordinary prose alone', () => {
    expect(renderTryBlocks('Un paragraphe : try this.')).toBe('Un paragraphe : try this.');
  });
});

describe('textOf', () => {
  it('drops markup and collapses whitespace for the search index', () => {
    expect(textOf('<h2>Titre</h2>\n<p>Du   texte</p>')).toBe('Titre Du texte');
  });

  it('decodes the entities the compiler introduced', () => {
    expect(textOf('<p>a &amp; b &lt;c&gt;</p>')).toBe('a & b <c>');
  });
});

describe('compileDoc', () => {
  it('compiles a well-formed page and collects its h2/h3 outline', () => {
    const doc = compileDoc(
      page(VALID, '## Charger\ntexte\n### Détail\n#### Trop profond\n'),
      'fr',
      'f.md',
    );
    expect(doc.slug).toBe('first-model');
    expect(doc.kind).toBe('tutorial');
    expect(doc.order).toBe(1);
    expect(doc.headings).toEqual([
      { id: 'charger', text: 'Charger', level: 2 },
      { id: 'detail', text: 'Détail', level: 3 },
    ]);
    // h4 is rendered but deliberately absent from the outline.
    expect(doc.html).toContain('<h4>Trop profond</h4>');
    expect(doc.html).toContain('<h2 id="charger">Charger</h2>');
  });

  it('indexes accent-folded text so search matches an unaccented query', () => {
    const doc = compileDoc(page(VALID, 'Le modèle est entraîné.'), 'fr', 'f.md');
    expect(doc.searchText).toContain('le modele est entraine');
  });

  it.each([
    ['slug', 'kind: tutorial\norder: 1\ntitle: T\nsummary: S'],
    ['title', 'slug: s\nkind: tutorial\norder: 1\nsummary: S'],
    ['summary', 'slug: s\nkind: tutorial\norder: 1\ntitle: T'],
  ])('refuses a page missing `%s`, naming the file', (field, front) => {
    expect(() => compileDoc(page(front, 'x'), 'fr', 'guide.md')).toThrow(
      new RegExp(`guide\\.md.*${field}`),
    );
  });

  it('refuses a kind outside the four Diátaxis quadrants', () => {
    // « notes » is where a tutorial quietly turns into a scratchpad.
    const front = 'slug: s\nkind: notes\norder: 1\ntitle: T\nsummary: S';
    expect(() => compileDoc(page(front, 'x'), 'fr', 'g.md')).toThrow(/kind.*must be one of/);
  });

  it('refuses a non-integer order rather than sorting on NaN', () => {
    const front = 'slug: s\nkind: tutorial\norder: first\ntitle: T\nsummary: S';
    expect(() => compileDoc(page(front, 'x'), 'fr', 'g.md')).toThrow(/order.*whole number/);
  });
});

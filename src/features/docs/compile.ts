/**
 * V32 — the documentation compiler.
 *
 * Markdown lives in `src/content/docs/<lang>/*.md` and is turned into HTML
 * **at build time**, never in the browser: the visitor downloads finished
 * pages, not a parser. That is also what keeps the promise on /privacy
 * intact — a hosted documentation service (Algolia, a doc portal) would be a
 * third-party call on a site whose whole claim is that it makes none.
 *
 * Everything here is a pure function of the file's text, so the pipeline is
 * unit-tested rather than inspected by eye. `marked` is a devDependency: this
 * module is imported by the Vite plugin and by its tests, never by the app.
 */
import { marked } from 'marked';

/** Diátaxis quadrant. Mixing them on one page is the classic docs failure: a
 *  tutorial that stops to weigh an alternative has lost the beginner. */
export type DocKind = 'tutorial' | 'how-to' | 'reference' | 'explanation';

export const DOC_KINDS: DocKind[] = ['tutorial', 'how-to', 'reference', 'explanation'];

export interface DocHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface DocPage {
  slug: string;
  lang: string;
  kind: DocKind;
  order: number;
  title: string;
  summary: string;
  /** Compiled HTML, ready for the page — no parser ships to the browser. */
  html: string;
  /** h2/h3 only: an outline deeper than that stops being an outline. */
  headings: DocHeading[];
  /** Lower-cased, accent-folded plain text for the local search index. */
  searchText: string;
}

const REQUIRED = ['slug', 'kind', 'order', 'title', 'summary'] as const;

/**
 * Split `---\nkey: value\n---\nbody`. Hand-rolled on purpose: the front matter
 * is five flat string keys, and pulling in a YAML parser to read five lines
 * would add a dependency that can express far more than this format allows —
 * every extra thing it accepts is a way for a page to be wrong quietly.
 */
export function splitFrontMatter(raw: string): { data: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw.replace(/^\uFEFF/, ''));
  if (!match) throw new Error('front matter missing (the file must start with ---)');
  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) throw new Error(`front matter line is not \`key: value\`: ${line}`);
    data[pair[1]] = pair[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
  return { data, body: match[2] };
}

/**
 * Accent-folded, lower-cased text. The search index has to match « modele »
 * typed without accents against « modèle » in the page: a French reader on a
 * hurried keyboard is the common case, not the exception.
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** GitHub-style slug, so a heading's anchor is guessable and stable. */
export function headingId(text: string): string {
  return (
    fold(text)
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'section'
  );
}

/**
 * `:::try <href> | <label>` becomes a link that DOES the thing.
 *
 * Rule (3) of the wave: better than a screenshot, a link that lands on the
 * panel with the demo already loaded. A screenshot is a promise about the past
 * — it rots silently the moment the UI moves, and nothing fails. A deep link
 * either works or is caught by the e2e suite.
 */
export function renderTryBlocks(markdown: string): string {
  return markdown.replace(
    /^:::try\s+(\S+)\s*\|\s*(.+?)\s*$/gm,
    (_, href: string, label: string) =>
      `<p class="doc-try"><a href="${escapeAttr(href)}" data-doc-try="${escapeAttr(href)}">${escapeHtml(label)}</a></p>`,
  );
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, '&quot;');

/** Strip tags for the search index — the reader searches prose, not markup. */
export function textOf(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One Markdown file → one finished page. Throws — loudly, with the file name —
 * on anything malformed: a docs build that half-succeeds ships a broken page,
 * and the whole point of this wave is documentation that cannot lie.
 */
export function compileDoc(raw: string, lang: string, file: string): DocPage {
  let data: Record<string, string>;
  let body: string;
  try {
    ({ data, body } = splitFrontMatter(raw));
  } catch (error) {
    throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  for (const key of REQUIRED) {
    if (!data[key]) throw new Error(`${file}: front matter is missing \`${key}\``);
  }
  if (!DOC_KINDS.includes(data.kind as DocKind)) {
    throw new Error(
      `${file}: \`kind\` must be one of ${DOC_KINDS.join(', ')} — got \`${data.kind}\``,
    );
  }
  const order = Number(data.order);
  if (!Number.isInteger(order)) throw new Error(`${file}: \`order\` must be a whole number`);

  const headings: DocHeading[] = [];
  const renderer = new marked.Renderer();
  renderer.heading = ({ text, depth }) => {
    const plain = textOf(marked.parseInline(text, { async: false }) as string);
    if (depth === 2 || depth === 3) {
      const id = headingId(plain);
      headings.push({ id, text: plain, level: depth });
      return `<h${depth} id="${id}">${marked.parseInline(text, { async: false }) as string}</h${depth}>\n`;
    }
    return `<h${depth}>${marked.parseInline(text, { async: false }) as string}</h${depth}>\n`;
  };

  // V35 — a wide table scrolls inside its own region, and that region is
  // reachable by keyboard. Putting `overflow-x` on the `<table>` itself (what
  // V32 did) failed twice at once: the box was a scroll container nobody could
  // tab into, which axe names `scrollable-region-focusable` and WCAG 2.1.1
  // calls a failure — the columns past the fold were unreachable without a
  // mouse; and the table's min-content width still propagated to the prose
  // column, so on a phone the *page* scrolled sideways instead of the table.
  // Wrapping is what fixes both, and it belongs here rather than in each of
  // the twelve pages: a rule the compiler enforces cannot be forgotten by the
  // next page someone writes.
  const renderTable = marked.Renderer.prototype.table;
  renderer.table = function (token) {
    // Name the region after the heading it sits under, so a screen reader
    // announces « Table: Reading a refusal » rather than an anonymous box.
    const under = headings[headings.length - 1]?.text;
    const fr = lang.startsWith('fr');
    const noun = fr ? 'Tableau' : 'Table';
    // French puts a space before the colon; English does not.
    const label = under ? `${noun}${fr ? ' : ' : ': '}${under}` : noun;
    return `<div class="doc-table" role="region" tabindex="0" aria-label="${escapeAttr(label)}">${renderTable.call(this, token)}</div>\n`;
  };

  const html = marked.parse(renderTryBlocks(body), {
    async: false,
    gfm: true,
    renderer,
  }) as string;

  return {
    slug: data.slug,
    lang,
    kind: data.kind as DocKind,
    order,
    title: data.title,
    summary: data.summary,
    html,
    headings,
    searchText: fold(`${data.title} ${data.summary} ${textOf(html)}`),
  };
}

/**
 * V32 — the local documentation search.
 *
 * A hosted search service (Algolia and friends) is the default answer here and
 * is not available to this site: the strict CSP allows no third party, and a
 * page that promises « nothing leaves your browser » cannot make its own
 * documentation the exception. So the index is built at compile time and
 * queried in memory.
 *
 * The corpus is a handful of pages, so this is a scan, not an inverted index:
 * at this size the honest implementation is the simple one, and a structure
 * that must be kept in sync is a bug waiting for the page count to grow.
 */
import type { DocPage } from '@/features/docs/compile';
import { fold } from '@/features/docs/compile';

export interface DocHit {
  page: DocPage;
  /** Words matched, for ranking and for showing why the page came up. */
  matched: string[];
  /** A snippet around the first match — plain text, already folded-safe. */
  excerpt: string;
}

const EXCERPT = 140;

/**
 * Every query word must appear somewhere in the page (AND, not OR). OR makes
 * a two-word query return more results than a one-word query, which reads as
 * the search being broken.
 */
export function searchDocs(pages: readonly DocPage[], query: string): DocHit[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const hits: DocHit[] = [];
  for (const page of pages) {
    if (!words.every((word) => page.searchText.includes(word))) continue;
    const at = page.searchText.indexOf(words[0]);
    const start = Math.max(0, at - EXCERPT / 2);
    hits.push({
      page,
      matched: words,
      excerpt:
        (start > 0 ? '…' : '') +
        page.searchText.slice(start, start + EXCERPT).trim() +
        (start + EXCERPT < page.searchText.length ? '…' : ''),
    });
  }

  // A hit in the title beats a hit in the body: someone typing « tutoriel »
  // wants the tutorial, not every page that mentions the word once.
  const inTitle = (page: DocPage) => words.filter((word) => fold(page.title).includes(word)).length;
  return hits.sort((a, b) => inTitle(b.page) - inTitle(a.page) || a.page.order - b.page.order);
}

/**
 * V35 — which title the browser tab should carry, for a given path.
 *
 * The audit measured this in a real browser across twelve routes: every one of
 * them showed `LabML`. The `<h1>` changed correctly, the tab never did, and
 * `document.title` was not assigned anywhere in the codebase — so three open
 * LabML tabs were indistinguishable, a bookmark said nothing about what it
 * pointed at, and every prerendered shell offered a search engine the same
 * nine-character title.
 *
 * The mapping is a pure function so it can be tested without a browser, and so
 * the prerender plugin and the running app can agree by construction rather
 * than by two people remembering to edit two lists.
 */

/** i18n key under `common.pageTitles`, or null when the page names itself. */
export type TitleKey = string | null;

/**
 * Static routes, longest path first so `/ai/vision` is matched before `/ai`.
 * Dynamic segments are handled by the prefix rules below.
 */
const EXACT: Record<string, string> = {
  '/': 'home',
  '/ml': 'ml',
  '/data': 'data',
  '/ai': 'ai',
  '/ai/vision': 'aiVision',
  '/ai/chat': 'aiChat',
  '/about': 'about',
  '/privacy': 'privacy',
  '/docs': 'docs',
};

const PREFIXES: [string, string][] = [
  ['/ml/run/', 'run'],
  ['/ml/compare/', 'compare'],
  ['/ml/compare-many/', 'compare'],
  ['/ml/share', 'share'],
];

/**
 * `null` means « this page sets its own title »: a documentation page is named
 * by its own front matter, and only the page holding the compiled Markdown
 * knows it. Returning a generic key here instead would make the tab say
 * « Documentation » for all twenty-four of them — better than `LabML`, but
 * still not the page's name.
 */
export function titleKeyFor(pathname: string): TitleKey {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path in EXACT) return EXACT[path];
  if (path.startsWith('/docs/')) return null;
  for (const [prefix, key] of PREFIXES) if (path.startsWith(prefix)) return key;
  // Anything left is a URL the router will answer with its not-found page.
  return 'notFound';
}

/**
 * `Page · LabML`, except on the home page, whose title already carries the
 * product name — « LabML — … · LabML » reads like a bug, because it is one.
 */
export function formatTitle(page: string, suffix: string): string {
  return page.includes(suffix) ? page : `${page} · ${suffix}`;
}

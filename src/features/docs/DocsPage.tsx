import { ArrowLeft, BookOpen, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { DOCS } from 'virtual:labml-docs';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { DOC_KINDS, type DocKind, type DocPage } from '@/features/docs/compile';
import { searchDocs } from '@/features/docs/search';
import { cn } from '@/lib/utils';

/**
 * The docs are FR/EN like the rest of the site, and the language is the app's
 * — not a separate switch. A page missing in the active language falls back to
 * the other one rather than showing an empty shelf; saying « not translated
 * yet » beats pretending the page does not exist.
 */
function pagesFor(lang: string): DocPage[] {
  const wanted = lang.startsWith('fr') ? 'fr' : 'en';
  const mine = DOCS.filter((page) => page.lang === wanted);
  return mine.length > 0 ? mine : DOCS.filter((page) => page.lang === 'en');
}

function KindBadge({ kind }: { kind: DocKind }) {
  const { t } = useTranslation();
  return <Badge variant="copper">{t(`docs.kinds.${kind}`)}</Badge>;
}

export function DocsPage() {
  const { t, i18n } = useTranslation();
  const { slug } = useParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const pages = useMemo(() => pagesFor(i18n.language), [i18n.language]);
  const hits = useMemo(() => searchDocs(pages, query), [pages, query]);
  const current = slug ? pages.find((page) => page.slug === slug) : undefined;

  // V35 — a doc page names its own tab. `titleKeyFor` returns null for
  // `/docs/:slug` precisely so this wins: twenty-four pages, twenty-four
  // titles, taken from the front matter rather than from a generic label.
  useEffect(() => {
    if (!slug) return;
    const name = current ? current.title : t('common.pageTitles.notFound');
    document.title = `${name} · ${t('common.pageTitles.suffix')}`;
  }, [slug, current, t]);

  // An unknown slug is a wrong link, not an empty page: say so and offer the index.
  if (slug && !current) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <Card className="flex flex-col items-start gap-3 border-copper">
          {/*
            V35 wave 4 — a refusal is still a page, and a page needs a heading.
            Looking at every route at three widths found two with no `<h1>` at
            all: this one and the invalid share link. Both are ordinary things
            a visitor hits — a stale bookmark, a renamed slug.
          */}
          <h1 className="font-display text-lg font-semibold">{t('common.pageTitles.notFound')}</h1>
          <p className="text-sm">{t('docs.notFound', { slug })}</p>
          <Link to="/docs" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('docs.backToIndex')}
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-12 sm:py-16">
        <Eyebrow>{t('docs.eyebrow')}</Eyebrow>
        <h1 className="mt-3 max-w-3xl font-display text-3xl font-bold text-balance sm:text-5xl">
          {current ? current.title : t('docs.title')}
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">
          {current ? current.summary : t('docs.lede')}
        </p>
      </section>

      {current ? (
        <DocView page={current} pages={pages} />
      ) : (
        <section className="grid gap-6 pb-20 lg:grid-cols-[18rem_1fr]">
          <div className="flex flex-col gap-3">
            <label htmlFor="docs-search" className="sr-only">
              {t('docs.searchLabel')}
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 focus-within:border-accent">
              <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
              <input
                id="docs-search"
                data-testid="docs-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('docs.searchPlaceholder')}
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>
            <p className="text-xs text-muted">{t('docs.searchNote')}</p>
          </div>

          <div className="flex flex-col gap-4" data-testid="docs-index">
            {query.trim() !== '' ? (
              hits.length === 0 ? (
                <Card className="text-sm text-muted" data-testid="docs-no-hit">
                  {t('docs.noHit', { query })}
                </Card>
              ) : (
                hits.map(({ page, excerpt }) => (
                  <Card key={page.slug} className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <KindBadge kind={page.kind} />
                      <Link
                        to={`/docs/${page.slug}`}
                        data-testid="docs-hit"
                        className="font-display text-lg font-semibold underline decoration-line underline-offset-4 hover:text-accent-strong"
                      >
                        {page.title}
                      </Link>
                    </div>
                    <p className="text-sm text-muted">{excerpt}</p>
                  </Card>
                ))
              )
            ) : (
              DOC_KINDS.filter((kind) => pages.some((page) => page.kind === kind)).map((kind) => (
                <section key={kind} className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-accent" aria-hidden="true" />
                    <Eyebrow>{t(`docs.kinds.${kind}`)}</Eyebrow>
                  </div>
                  <p className="max-w-2xl text-sm text-muted">{t(`docs.kindNotes.${kind}`)}</p>
                  {pages
                    .filter((page) => page.kind === kind)
                    .map((page) => (
                      <Card key={page.slug} className="flex flex-col gap-1">
                        <Link
                          to={`/docs/${page.slug}`}
                          data-testid="docs-link"
                          className="font-display text-lg font-semibold underline decoration-line underline-offset-4 hover:text-accent-strong"
                        >
                          {page.title}
                        </Link>
                        <p className="text-sm text-muted">{page.summary}</p>
                      </Card>
                    ))}
                </section>
              ))
            )}
          </div>
        </section>
      )}

      {!current && (
        <section className="pb-20">
          <button
            type="button"
            onClick={() => navigate('/ml')}
            className={cn(buttonVariants({ variant: 'outline' }))}
          >
            {t('docs.toLab')}
          </button>
        </section>
      )}
    </div>
  );
}

function DocView({ page, pages }: { page: DocPage; pages: DocPage[] }) {
  const { t } = useTranslation();
  return (
    <section className="grid gap-8 pb-20 lg:grid-cols-[1fr_16rem]">
      <article
        data-testid="doc-body"
        // `min-w-0`: a grid item defaults to `min-width: auto`, so the widest
        // thing inside — a table's min-content width — sets the column's floor
        // and the whole page scrolls sideways on a phone. Without this the
        // wrapper below can scroll all it likes and the page still overflows.
        className="doc-prose min-w-0 max-w-3xl"
        // The HTML was compiled at build time from Markdown committed to this
        // repository — no visitor input reaches it, and the CSP forbids inline
        // script regardless. Parsing in the browser instead would ship a
        // Markdown parser to every reader for no gain.
        dangerouslySetInnerHTML={{ __html: page.html }}
      />
      <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
        <div className="flex flex-col gap-2">
          <Eyebrow>{t('docs.onThisPage')}</Eyebrow>
          <nav aria-label={t('docs.onThisPage')}>
            <ol className="flex flex-col gap-1.5 text-sm" data-testid="doc-toc">
              {page.headings.map((heading) => (
                <li key={heading.id} className={heading.level === 3 ? 'pl-4' : undefined}>
                  <a
                    href={`#${heading.id}`}
                    className="text-muted underline decoration-line underline-offset-4 hover:text-accent-strong"
                  >
                    {heading.text}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <Eyebrow>{t('docs.otherPages')}</Eyebrow>
          {pages
            .filter((other) => other.slug !== page.slug)
            .map((other) => (
              <Link
                key={other.slug}
                to={`/docs/${other.slug}`}
                className="text-sm text-muted underline decoration-line underline-offset-4 hover:text-accent-strong"
              >
                {other.title}
              </Link>
            ))}
          <Link
            to="/docs"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-2 w-fit')}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('docs.backToIndex')}
          </Link>
        </div>
      </aside>
    </section>
  );
}

export default DocsPage;

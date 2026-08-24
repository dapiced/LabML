import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router';
import { Footer } from '@/app/Footer';
import { Header } from '@/app/Header';
import { ReloadPrompt } from '@/app/ReloadPrompt';
import { formatTitle, titleKeyFor } from '@/lib/page-title';

export function RootLayout() {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();

  // V35 — `document.title` was never assigned anywhere in the app: all twelve
  // routes showed `LabML`, so open tabs were indistinguishable and a bookmark
  // said nothing about what it pointed at. It follows the language too, since
  // the tab is as much a part of the page as the heading.
  //
  // A null key means the page names itself — the documentation pages, whose
  // titles live in their own front matter. Skipping them here rather than
  // setting a generic title first also avoids a fight over effect order:
  // a child's effect runs before its parent's, so anything written here would
  // otherwise overwrite what the page had just set.
  useEffect(() => {
    const key = titleKeyFor(pathname);
    if (key)
      document.title = formatTitle(t(`common.pageTitles.${key}`), t('common.pageTitles.suffix'));
  }, [pathname, t, i18n.language]);

  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#main"
        className="sr-only rounded-full bg-accent px-4 py-2 text-accent-contrast focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        {t('common.skipToContent')}
      </a>
      <Header />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <ReloadPrompt />
    </div>
  );
}

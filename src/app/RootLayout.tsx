import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { Footer } from '@/app/Footer';
import { Header } from '@/app/Header';

export function RootLayout() {
  const { t } = useTranslation();
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
    </div>
  );
}

import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { cn } from '@/lib/utils';

/** Shared layout for the sections that are planned but not built yet (/data, /ai). */
export function PlaceholderPage({ namespace }: { namespace: 'data' | 'ai' }) {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-16 sm:py-24">
        <Eyebrow>{t(`${namespace}.eyebrow`)}</Eyebrow>
        <h1 className="mt-3 max-w-3xl font-display text-3xl font-bold text-balance sm:text-5xl">
          {t(`${namespace}.title`)}
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">{t(`${namespace}.lede`)}</p>
        <div className="mt-8">
          <Link to="/" className={cn(buttonVariants({ variant: 'outline' }))}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t(`${namespace}.backHome`)}
          </Link>
        </div>
      </section>
    </div>
  );
}

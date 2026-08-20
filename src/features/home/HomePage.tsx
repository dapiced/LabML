import { ArrowRight, Braces, Database, FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { cn } from '@/lib/utils';

export function HomePage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-16 sm:py-24">
        <Eyebrow>{t('home.eyebrow')}</Eyebrow>
        <h1 className="mt-3 max-w-3xl font-display text-4xl font-bold text-balance sm:text-6xl">
          {t('home.titlePre')}{' '}
          <span className="bg-accent-soft box-decoration-clone px-1 text-accent-strong">
            {t('home.titleHighlight')}
          </span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted">{t('home.lede')}</p>
        <div className="mt-8">
          <Link to="/ml" className={cn(buttonVariants({ size: 'lg' }))}>
            {t('home.openLab')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="grid gap-4 pb-16 sm:grid-cols-3">
        <Card className="flex flex-col gap-3">
          <FlaskConical className="h-6 w-6 text-accent" aria-hidden="true" />
          <h2 className="font-display text-xl font-semibold">
            <Link to="/ml" className="hover:underline">
              {t('home.modules.ml.title')}
            </Link>
          </h2>
          <p className="text-sm text-muted">{t('home.modules.ml.description')}</p>
        </Card>
        <Card className="flex flex-col gap-3">
          <Database className="h-6 w-6 text-copper" aria-hidden="true" />
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
            {t('home.modules.data.title')}
            <Badge variant="copper">{t('common.soon')}</Badge>
          </h2>
          <p className="text-sm text-muted">{t('home.modules.data.description')}</p>
        </Card>
        <Card className="flex flex-col gap-3">
          <Braces className="h-6 w-6 text-copper" aria-hidden="true" />
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
            {t('home.modules.ai.title')}
            <Badge variant="copper">{t('common.soon')}</Badge>
          </h2>
          <p className="text-sm text-muted">{t('home.modules.ai.description')}</p>
        </Card>
      </section>

      <section className="pb-20">
        <Card className="bg-surface-2">
          <Eyebrow>{t('home.statusTitle')}</Eyebrow>
          <p className="mt-2 max-w-3xl text-sm text-muted">{t('home.statusBody')}</p>
        </Card>
      </section>
    </div>
  );
}

export default HomePage;

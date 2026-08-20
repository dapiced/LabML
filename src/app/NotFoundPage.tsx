import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex max-w-6xl flex-col items-start px-4 py-24">
      <p className="font-mono text-sm text-copper">404</p>
      <h1 className="mt-3 font-display text-3xl font-bold sm:text-5xl">{t('notFound.title')}</h1>
      <p className="mt-4 text-lg text-muted">{t('notFound.lede')}</p>
      <Link to="/" className={cn(buttonVariants({ variant: 'outline' }), 'mt-8')}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('notFound.backHome')}
      </Link>
    </div>
  );
}

export default NotFoundPage;

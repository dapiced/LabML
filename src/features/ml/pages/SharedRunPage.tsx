import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/button';
import { RunView } from '@/features/ml/components/RunView';
import { decodeShareFragment } from '@/features/ml/projects/share';
import { cn } from '@/lib/utils';

export function SharedRunPage() {
  const { t } = useTranslation();
  // The payload travels in the URL fragment — never sent to any server.
  const [payload] = useState(() => decodeShareFragment(window.location.hash.slice(1)));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link to="/ml" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('ml.lab.runs.backToLab')}
        </Link>
        <p className="flex items-center gap-2 text-xs text-muted">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
          {t('ml.lab.share.note')}
        </p>
      </div>
      {payload ? (
        <RunView record={payload} />
      ) : (
        <p className="text-muted">{t('ml.lab.share.invalid')}</p>
      )}
    </div>
  );
}

export default SharedRunPage;

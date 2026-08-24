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
        /*
          V35 wave 4 — the refusal is a page, not a stray sentence.

          Looking at all 17 routes at three widths turned up exactly one with
          no `<h1>` at all: this branch, which rendered a single grey line into
          an otherwise empty page. It is also the branch that now runs far more
          often, because `decodeShareFragment` stopped accepting payloads it
          could not render — before this wave those reached `RunView` and left
          a white page instead.

          The most common way to land here is not an attacker: it is a real
          share link that a chat client cut in half. So the page says which
          part is missing and what to do about it.
        */
        <div className="max-w-prose rounded-lg border border-line p-6">
          <h1 className="font-display text-lg font-semibold">{t('ml.lab.share.invalidTitle')}</h1>
          <p className="mt-2 text-sm text-muted">{t('ml.lab.share.invalid')}</p>
          <p className="mt-3 text-sm text-muted">{t('ml.lab.share.invalidHelp')}</p>
        </div>
      )}
    </div>
  );
}

export default SharedRunPage;

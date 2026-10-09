import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Component, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/button';
import { RunView } from '@/features/ml/components/RunView';
import { decodeShareFragment } from '@/features/ml/projects/share';
import { cn } from '@/lib/utils';

/**
 * V48 — the last line of defence for a link that decodes but cannot be drawn.
 *
 * `decodeShareFragment` checks what every view reads first. It cannot check
 * everything: a run carries up to nine analyses, each with its own nested
 * shape, and a validator for all of them would drift every time an analysis
 * is added. Measured on three real links (titanic, iris with tuning and
 * groups, mpg) and every field of them deleted, nulled or retyped: 3 660 of
 * 3 948 crafted links passed the decoder and 1 020 of those crashed the page,
 * on 99 distinct paths. Rather than chase them one by one, a render failure
 * inside the run is caught here and turned into the same refusal the decoder
 * gives, with its own explanation. Nothing from the run is shown: a page
 * that rendered half a run would let a damaged figure pass for a real one.
 */
class ShareRenderGuard extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function InvalidShare({ reason }: { reason: 'invalid' | 'unreadable' }) {
  const { t } = useTranslation();
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
  return (
    <div data-testid="share-refused" className="max-w-prose rounded-lg border border-line p-6">
      <h1 className="font-display text-lg font-semibold">{t('ml.lab.share.invalidTitle')}</h1>
      <p className="mt-2 text-sm text-muted">{t('ml.lab.share.invalid')}</p>
      <p className="mt-3 text-sm text-muted">
        {t(reason === 'unreadable' ? 'ml.lab.share.unreadable' : 'ml.lab.share.invalidHelp')}
      </p>
    </div>
  );
}

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
        <ShareRenderGuard fallback={<InvalidShare reason="unreadable" />}>
          <RunView record={payload} />
        </ShareRenderGuard>
      ) : (
        <InvalidShare reason="invalid" />
      )}
    </div>
  );
}

export default SharedRunPage;

import { BookOpenCheck, Shuffle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useLabStore } from '@/features/ml/lab-store';
import { isTrainingBusy } from '@/features/ml/store/fence';
import { freshSeed, readLedger, seedDealsTheTest, testSetKey } from '@/features/ml/train/ledger';

/**
 * V60: how many distinct configurations the current test set has scored, and
 * what that does to the best score seen. Silent until there is something to
 * count; offers a fresh split only once the test set is worn, because a split
 * redrawn at will is one more thing to shop with.
 */
export function TestLedgerPanel() {
  const { t } = useTranslation();
  const meta = useLabStore((s) => s.meta);
  const target = useLabStore((s) => s.target);
  const entries = useLabStore((s) => s.ledgerEntries);
  const stateSeed = useLabStore((s) => s.seed);
  const splitChoice = useLabStore((s) => s.splitChoice);
  const summary = useLabStore((s) => s.summary);
  const trainStatus = useLabStore((s) => s.trainStatus);
  const busy = useLabStore(isTrainingBusy);
  const drawFreshSplit = useLabStore((s) => s.drawFreshSplit);
  if (!meta || !target) return null;

  // A finished run is read on the split it was trained with; before that, on
  // the split the next training would use.
  const done = trainStatus === 'done' && summary !== null;
  const seed = done ? summary.seed : stateSeed;
  const split = done
    ? summary.split
      ? { mode: summary.split.mode, column: summary.split.column }
      : null
    : splitChoice;
  const reading = readLedger(entries, testSetKey(meta, target, seed, split));
  if (reading.reads === 0) return null;

  const dealt = seedDealsTheTest(split);
  const worn = reading.level === 'worn' || reading.level === 'spent';
  const next = freshSeed(entries, seed);

  return (
    <section
      data-testid="ledger-panel"
      data-level={reading.level}
      className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <BookOpenCheck className="h-4 w-4 text-accent" aria-hidden="true" />
        <Eyebrow>{t('ml.lab.ledger.title')}</Eyebrow>
        <Badge variant="outline" data-testid="ledger-reads">
          {t('ml.lab.ledger.badge', { count: reading.reads })}
        </Badge>
        {dealt && reading.splits > 1 && (
          <Badge variant="outline" data-testid="ledger-split">
            {t('ml.lab.ledger.splitBadge', { splits: reading.splits, seed })}
          </Badge>
        )}
      </div>

      <p className="max-w-3xl text-sm" data-testid="ledger-verdict">
        {t(`ml.lab.ledger.${reading.level}`, { reads: reading.reads })}
      </p>
      {!done && <p className="max-w-3xl text-xs text-muted">{t('ml.lab.ledger.before')}</p>}
      {dealt && reading.splits > 1 && (
        <p className="max-w-3xl text-xs text-muted" data-testid="ledger-redeal">
          {t('ml.lab.ledger.redeal')}
        </p>
      )}

      {worn && dealt && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={drawFreshSplit}
            data-testid="ledger-fresh"
          >
            <Shuffle className="h-4 w-4" aria-hidden="true" />
            {t('ml.lab.ledger.fresh', { seed: next })}
          </Button>
          <span className="max-w-xl text-xs text-muted">{t('ml.lab.ledger.freshHint')}</span>
        </div>
      )}
      {worn && !dealt && (
        <p className="max-w-3xl text-xs text-muted" data-testid="ledger-chronological">
          {t('ml.lab.ledger.chronological')}
        </p>
      )}

      <p className="max-w-3xl text-xs text-muted">{t('ml.lab.ledger.counted')}</p>
    </section>
  );
}

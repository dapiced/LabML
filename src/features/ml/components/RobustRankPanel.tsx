import { Loader2, Scale, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useLabStore } from '@/features/ml/lab-store';
import type { RobustRankResult } from '@/features/ml/train/robust';

/**
 * V35: the robust leaderboard — 5×2 repeated cross-validation, on demand.
 *
 * A single split's ranking can hinge on which rows landed in the draw; ten
 * seeded fits per family produce a mean, a spread, and a plain answer to the
 * only question that matters: is the order between the top two models real,
 * or inside the noise? Runs on train+validation only — the test set is never
 * part of the folds.
 */
export function RobustRankPanel() {
  const { t, i18n } = useTranslation();
  const trainStatus = useLabStore((s) => s.trainStatus);
  const results = useLabStore((s) => s.results);
  const robustStatus = useLabStore((s) => s.robustStatus);
  const robustProgress = useLabStore((s) => s.robustProgress);
  const outcome = useLabStore((s) => s.robustOutcome);
  const robustRank = useLabStore((s) => s.robustRank);
  const cancelRobust = useLabStore((s) => s.cancelRobust);

  if (trainStatus !== 'done' || results.filter((r) => r.ok).length < 2) return null;

  const lang = i18n.resolvedLanguage ?? 'en';
  const running = robustStatus === 'running';
  const fmt = (v: number) =>
    v.toLocaleString(lang, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  return (
    <section
      data-testid="robust-rank"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
    >
      <div>
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-accent" aria-hidden="true" />
          <Eyebrow>{t('ml.lab.robust.title')}</Eyebrow>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-muted">{t('ml.lab.robust.hint')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <>
            <span className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
              {robustProgress
                ? t('ml.lab.robust.progress', {
                    done: robustProgress.done,
                    total: robustProgress.total,
                  })
                : t('ml.lab.robust.preparing')}
            </span>
            <Button variant="outline" size="sm" onClick={cancelRobust}>
              <Square className="h-3.5 w-3.5" aria-hidden="true" />
              {t('ml.lab.cancel')}
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={robustRank} data-testid="robust-run">
            {t('ml.lab.robust.run')}
          </Button>
        )}
      </div>

      {outcome && !running && <RobustOutcome outcome={outcome} fmt={fmt} lang={lang} />}
    </section>
  );
}

function RobustOutcome({
  outcome,
  fmt,
  lang,
}: {
  outcome: RobustRankResult;
  fmt: (v: number) => string;
  lang: string;
}) {
  const { t } = useTranslation();
  const folds = outcome.reps * 2;
  const pair = outcome.topPair;
  const stable = pair !== null && pair.leaderWins >= folds - 1;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full max-w-2xl text-left text-sm">
          <thead>
            <tr className="font-mono text-[0.68rem] tracking-wider uppercase text-muted">
              <th className="py-1.5 pr-3 font-medium">#</th>
              <th className="py-1.5 pr-3 font-medium">{t('ml.lab.leaderboard.model')}</th>
              <th className="py-1.5 pr-3 font-medium">{t('ml.lab.robust.mean')}</th>
              <th className="py-1.5 pr-3 font-medium">{t('ml.lab.robust.sd')}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {outcome.entries.map((entry, rank) => (
              <tr key={entry.model} className="border-t border-line">
                <td className="py-1.5 pr-3 font-mono text-xs">{rank + 1}</td>
                <td className="py-1.5 pr-3">{t(`ml.lab.models.${entry.model}`)}</td>
                <td className="py-1.5 pr-3 font-medium">{fmt(entry.mean)}</td>
                <td className="py-1.5 pr-3 text-muted">± {fmt(entry.sd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pair && (
        <p className="max-w-3xl text-sm" data-testid="robust-verdict">
          {t(stable ? 'ml.lab.robust.verdictStable' : 'ml.lab.robust.verdictNoise', {
            leader: t(`ml.lab.models.${pair.leader}`),
            runnerUp: t(`ml.lab.models.${pair.runnerUp}`),
            wins: pair.leaderWins,
            folds: pair.folds,
          })}
        </p>
      )}
      <p className="text-xs text-muted">
        {t('ml.lab.robust.note', {
          folds,
          reps: outcome.reps,
          rows: outcome.rows.toLocaleString(lang),
        })}
      </p>
    </div>
  );
}

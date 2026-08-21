import { MoveHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useLabStore } from '@/features/ml/lab-store';

/**
 * v20 honest uncertainty: every leaderboard metric gets its 95% bootstrap
 * interval, and the winner-vs-baseline gap gets a paired verdict. A wide
 * interval is information, not a defect.
 */
export function UncertaintyPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const analysis = useLabStore((s) => s.uncertaintyAnalysis);
  if (!analysis) return null;

  const metricName = t(`ml.lab.leaderboard.${analysis.metricLabel}`);
  const fmt = (v: number) => v.toFixed(3);
  const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(3)}`;
  const min = Math.min(...analysis.intervals.map((i) => i.lo));
  const max = Math.max(...analysis.intervals.map((i) => i.hi));
  const span = max - min || 1;
  const at = (v: number) => `${(((v - min) / span) * 100).toFixed(2)}%`;

  const verdict = analysis.verdict;
  const verdictText = verdict
    ? t(verdict.decisive ? 'ml.lab.uncertainty.verdictReal' : 'ml.lab.uncertainty.verdictNoise', {
        winner: t(`ml.lab.models.${verdict.winner}`),
        against: t(`ml.lab.models.${verdict.against}`),
        metric: metricName,
        delta: signed(verdict.delta),
        lo: signed(verdict.lo),
        hi: signed(verdict.hi),
        share: (verdict.winShare * 100).toLocaleString(lang, { maximumFractionDigits: 1 }),
      })
    : null;

  return (
    <section
      data-testid="uncertainty-panel"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <MoveHorizontal className="h-4 w-4 text-accent" aria-hidden="true" />
          <Eyebrow>{t('ml.lab.uncertainty.title')}</Eyebrow>
          <Badge variant="outline" className="font-mono">
            {t('ml.lab.uncertainty.badge', {
              resamples: analysis.resamples.toLocaleString(lang),
            })}
          </Badge>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-muted">
          {t('ml.lab.uncertainty.hint', {
            metric: metricName,
            rows: analysis.testRows.toLocaleString(lang),
          })}
        </p>
      </div>

      <ul className="flex flex-col gap-1.5">
        {analysis.intervals.map((interval, index) => (
          <li key={interval.model} className="flex items-center gap-2 text-xs">
            <span
              className={`w-28 truncate ${index === 0 ? 'font-semibold' : ''}`}
              title={t(`ml.lab.models.${interval.model}`)}
            >
              {t(`ml.lab.models.${interval.model}`)}
            </span>
            <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-surface-2">
              <span
                className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent opacity-40"
                style={{
                  left: at(interval.lo),
                  width: `calc(${at(interval.hi)} - ${at(interval.lo)})`,
                }}
              />
              <span
                className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
                style={{ left: at(interval.point) }}
              />
            </span>
            <span className="w-40 text-right font-mono tabular-nums">
              {fmt(interval.point)}{' '}
              <span className="text-muted">
                [{fmt(interval.lo)} ; {fmt(interval.hi)}]
              </span>
            </span>
          </li>
        ))}
      </ul>

      {verdictText && (
        <p
          data-testid="uncertainty-verdict"
          className={`rounded-xl p-3 text-sm ${
            verdict!.decisive ? 'bg-accent-soft' : 'bg-copper-soft'
          }`}
        >
          {verdictText}
        </p>
      )}

      <p className="text-xs text-muted">
        {t('ml.lab.uncertainty.note', {
          rows: analysis.testRows.toLocaleString(lang),
          seed: analysis.seed,
        })}
      </p>
    </section>
  );
}

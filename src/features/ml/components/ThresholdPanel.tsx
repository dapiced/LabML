import { Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useLabStore } from '@/features/ml/lab-store';
import { bestThresholdByCost, thresholdMetrics } from '@/features/ml/train/threshold';

/**
 * Imbalance tools for binary runs: a probability is not a decision — the
 * threshold is, and it belongs to the user's costs, not to the model.
 */
export function ThresholdPanel() {
  const { t, i18n } = useTranslation();
  const analysis = useLabStore((s) => s.thresholdAnalysis);
  const setThresholdClass = useLabStore((s) => s.setThresholdClass);
  const choice = useLabStore((s) => s.thresholdChoice);
  const chooseThreshold = useLabStore((s) => s.chooseThreshold);
  if (!analysis) return null;

  const lang = i18n.resolvedLanguage ?? 'en';
  const y = analysis.pairs.map(([, label]) => label);
  const p = analysis.pairs.map(([proba]) => proba);
  const at = thresholdMetrics(y, p, choice.threshold, choice.costFp, choice.costFn);
  const atDefault = thresholdMetrics(y, p, 0.5, choice.costFp, choice.costFn);
  const best = bestThresholdByCost(y, p, choice.costFp, choice.costFn);
  const pct = (v: number) => (v * 100).toLocaleString(lang, { maximumFractionDigits: 1 });

  const prPath = analysis.pr.points
    .map((pt) => `${(pt.recall * 100).toFixed(2)},${(100 - pt.precision * 100).toFixed(2)}`)
    .join(' ');
  const baselineY = 100 - analysis.pr.positiveRate * 100;

  const metricRows = [
    ['precision', at.precision, atDefault.precision],
    ['recall', at.recall, atDefault.recall],
    ['f1', at.f1, atDefault.f1],
    ['accuracy', at.accuracy, atDefault.accuracy],
  ] as const;

  return (
    <section
      data-testid="threshold-panel"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Scale className="h-4 w-4 text-accent" aria-hidden="true" />
          <Eyebrow>{t('ml.lab.threshold.title')}</Eyebrow>
          <Badge variant="outline">AP {analysis.pr.averagePrecision.toFixed(3)}</Badge>
          <Badge variant="outline">Brier {analysis.calibration.brier.toFixed(3)}</Badge>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-muted">
          {t('ml.lab.threshold.hint', {
            positive: analysis.positiveClass,
            rate: pct(analysis.pr.positiveRate),
          })}
        </p>
        {analysis.oneVsRest && (
          <div className="mt-2 flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-xs">
              {t('ml.lab.threshold.focusClass')}
              <select
                data-testid="threshold-class"
                className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
                value={analysis.oneVsRest.classIndex}
                onChange={(event) => setThresholdClass(Number(event.target.value))}
              >
                {analysis.oneVsRest.classes.map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p className="max-w-3xl text-xs text-muted">
              {t('ml.lab.threshold.oneVsRestNote', { class: analysis.positiveClass })}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-6">
        <figure className="flex flex-col gap-1">
          <figcaption className="text-xs text-muted">{t('ml.lab.threshold.prTitle')}</figcaption>
          <svg
            viewBox="-8 -4 116 116"
            className="w-52"
            role="img"
            aria-label={t('ml.lab.threshold.prTitle')}
          >
            <rect x="0" y="0" width="100" height="100" fill="var(--surface-2)" rx="4" />
            <line
              x1="0"
              y1={baselineY}
              x2="100"
              y2={baselineY}
              stroke="var(--muted)"
              strokeWidth="0.8"
              strokeDasharray="3 3"
              opacity="0.5"
            />
            <polyline
              points={prPath}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <circle
              cx={at.recall * 100}
              cy={100 - at.precision * 100}
              r="3.4"
              fill="var(--copper, #c65a1a)"
              stroke="var(--surface)"
              strokeWidth="1.2"
            />
            <text x="50" y="112" textAnchor="middle" fontSize="6" fill="var(--muted)">
              {t('ml.lab.threshold.recall')}
            </text>
            <text
              x="-4"
              y="50"
              textAnchor="middle"
              fontSize="6"
              fill="var(--muted)"
              transform="rotate(-90 -4 50)"
            >
              {t('ml.lab.threshold.precision')}
            </text>
          </svg>
        </figure>

        <figure className="flex flex-col gap-1">
          <figcaption className="text-xs text-muted">
            {t('ml.lab.threshold.calibrationTitle')}
          </figcaption>
          <svg
            viewBox="-8 -4 116 116"
            className="w-52"
            role="img"
            aria-label={t('ml.lab.threshold.calibrationTitle')}
          >
            <rect x="0" y="0" width="100" height="100" fill="var(--surface-2)" rx="4" />
            <line
              x1="0"
              y1="100"
              x2="100"
              y2="0"
              stroke="var(--muted)"
              strokeWidth="0.8"
              strokeDasharray="3 3"
              opacity="0.5"
            />
            <polyline
              points={analysis.calibration.bins
                .map(
                  (bin) =>
                    `${(bin.meanPredicted * 100).toFixed(2)},${(100 - bin.observedRate * 100).toFixed(2)}`,
                )
                .join(' ')}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.4"
              opacity="0.7"
            />
            {analysis.calibration.bins.map((bin, i) => (
              <circle
                key={i}
                cx={bin.meanPredicted * 100}
                cy={100 - bin.observedRate * 100}
                r="2.6"
                fill="var(--accent)"
              />
            ))}
            <text x="50" y="112" textAnchor="middle" fontSize="6" fill="var(--muted)">
              {t('ml.lab.threshold.predictedProb')}
            </text>
            <text
              x="-4"
              y="50"
              textAnchor="middle"
              fontSize="6"
              fill="var(--muted)"
              transform="rotate(-90 -4 50)"
            >
              {t('ml.lab.threshold.observedRate')}
            </text>
          </svg>
        </figure>

        <div className="flex min-w-64 flex-1 flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-baseline justify-between">
              {t('ml.lab.threshold.threshold')}
              <span className="font-mono text-xs" data-testid="threshold-value">
                {choice.threshold.toFixed(2)}
              </span>
            </span>
            <input
              type="range"
              min={0.01}
              max={0.99}
              step={0.01}
              value={choice.threshold}
              onChange={(e) => chooseThreshold({ threshold: Number(e.target.value) })}
              className="accent-(--accent)"
              data-testid="threshold-slider"
            />
          </label>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t('ml.lab.threshold.costFp')}
              <input
                type="number"
                min={0}
                step={1}
                value={choice.costFp}
                onChange={(e) => chooseThreshold({ costFp: Math.max(0, Number(e.target.value)) })}
                className="h-8 w-20 rounded-lg border border-line bg-surface px-2 font-mono text-sm text-ink"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t('ml.lab.threshold.costFn')}
              <input
                type="number"
                min={0}
                step={1}
                value={choice.costFn}
                onChange={(e) => chooseThreshold({ costFn: Math.max(0, Number(e.target.value)) })}
                className="h-8 w-20 rounded-lg border border-line bg-surface px-2 font-mono text-sm text-ink"
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => chooseThreshold({ threshold: best.threshold })}
              data-testid="threshold-best"
            >
              {t('ml.lab.threshold.bestForCosts', { threshold: best.threshold.toFixed(2) })}
            </Button>
          </div>

          <table className="w-full max-w-sm text-left text-xs" data-testid="threshold-metrics">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="py-1 pr-3 font-normal">{t('ml.lab.batch.colMetric')}</th>
                <th className="py-1 pr-3 font-normal">
                  {t('ml.lab.threshold.atChosen', { threshold: choice.threshold.toFixed(2) })}
                </th>
                <th className="py-1 font-normal">{t('ml.lab.threshold.atDefault')}</th>
              </tr>
            </thead>
            <tbody>
              {metricRows.map(([key, chosen, fallback]) => (
                <tr key={key} className="border-b border-line last:border-b-0">
                  <td className="py-1 pr-3">{t(`ml.lab.threshold.${key}`)}</td>
                  <td className="py-1 pr-3 font-mono tabular-nums">{chosen.toFixed(3)}</td>
                  <td className="py-1 font-mono tabular-nums text-muted">{fallback.toFixed(3)}</td>
                </tr>
              ))}
              <tr>
                <td className="py-1 pr-3">{t('ml.lab.threshold.cost')}</td>
                <td className="py-1 pr-3 font-mono tabular-nums">{at.cost.toLocaleString(lang)}</td>
                <td className="py-1 font-mono tabular-nums text-muted">
                  {atDefault.cost.toLocaleString(lang)}
                </td>
              </tr>
            </tbody>
          </table>

          <p className="font-mono text-[0.68rem] text-muted">
            TP {at.tp} · FP {at.fp} · FN {at.fn} · TN {at.tn}
          </p>
        </div>
      </div>

      <p className="text-xs text-muted">{t('ml.lab.threshold.note')}</p>
    </section>
  );
}

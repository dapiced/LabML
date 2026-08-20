import { useTranslation } from 'react-i18next';
import { Eyebrow } from '@/components/ui/eyebrow';

export function ScatterPlot({ points }: { points: { actual: number; predicted: number }[] }) {
  const { t } = useTranslation();
  const values = points.flatMap((p) => [p.actual, p.predicted]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (v: number) => ((v - min) / span) * 100;
  const y = (v: number) => 100 - ((v - min) / span) * 100;

  return (
    <div
      data-testid="scatter"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4"
    >
      <Eyebrow>{t('ml.lab.insights.scatterTitle')}</Eyebrow>
      <svg
        viewBox="-8 -4 116 116"
        className="max-w-56"
        role="img"
        aria-label={t('ml.lab.insights.scatterTitle')}
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
          opacity="0.6"
        />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(p.actual)}
            cy={y(p.predicted)}
            r="1.6"
            fill="var(--accent)"
            opacity="0.55"
          >
            <title>{`${t('ml.lab.insights.actualShort')} ${p.actual} → ${p.predicted.toFixed(2)}`}</title>
          </circle>
        ))}
        <text x="50" y="112" textAnchor="middle" fontSize="6" fill="var(--muted)">
          {t('ml.lab.insights.actualShort')}
        </text>
        <text
          x="-4"
          y="50"
          textAnchor="middle"
          fontSize="6"
          fill="var(--muted)"
          transform="rotate(-90 -4 50)"
        >
          {t('ml.lab.insights.predictedShort')}
        </text>
      </svg>
    </div>
  );
}

export function ResidualsChart({
  residuals,
}: {
  residuals: { counts: number[]; min: number; max: number };
}) {
  const { t } = useTranslation();
  const peak = Math.max(...residuals.counts, 1);
  const width =
    residuals.counts.length > 0 ? (residuals.max - residuals.min) / residuals.counts.length : 0;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <Eyebrow>{t('ml.lab.insights.residualsTitle')}</Eyebrow>
      <div className="flex h-24 items-end gap-[2px]" role="img" aria-hidden="true">
        {residuals.counts.map((count, i) => (
          <div
            key={i}
            className="min-h-[2px] flex-1 rounded-t-[2px] bg-accent/75"
            style={{ height: `${(count / peak) * 100}%` }}
            title={`${(residuals.min + i * width).toFixed(2)} – ${(residuals.min + (i + 1) * width).toFixed(2)} : ${count}`}
          />
        ))}
      </div>
      <p className="flex justify-between font-mono text-[0.65rem] text-muted tabular-nums">
        <span>{residuals.min.toFixed(2)}</span>
        <span>{t('ml.lab.insights.residualsHint')}</span>
        <span>{residuals.max.toFixed(2)}</span>
      </p>
    </div>
  );
}

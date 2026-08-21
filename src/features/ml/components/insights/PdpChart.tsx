import { useTranslation } from 'react-i18next';
import { Eyebrow } from '@/components/ui/eyebrow';

function formatShort(value: number): string {
  if (Math.abs(value) >= 1000)
    return Intl.NumberFormat('en', { notation: 'compact' }).format(value);
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** Partial-dependence line: mean prediction as one column sweeps its range. */
export function PdpChart({
  column,
  points,
}: {
  column: string;
  points: { x: number; y: number }[];
}) {
  const { t } = useTranslation();
  const ys = points.map((p) => p.y);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const ySpan = yMax - yMin || 1;
  const xMin = points[0]?.x ?? 0;
  const xMax = points[points.length - 1]?.x ?? 1;
  const xSpan = xMax - xMin || 1;

  const path = points.map(
    (p) =>
      `${(((p.x - xMin) / xSpan) * 100).toFixed(2)},${(100 - ((p.y - yMin) / ySpan) * 90 - 5).toFixed(2)}`,
  );

  return (
    <div
      data-testid="pdp"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4"
    >
      <Eyebrow>
        {t('ml.lab.insights.pdpTitle')} · <span className="normal-case">{column}</span>
      </Eyebrow>
      <svg
        viewBox="-4 -4 112 116"
        className="max-w-56"
        role="img"
        aria-label={`${t('ml.lab.insights.pdpTitle')} ${column}`}
      >
        <rect x="0" y="0" width="100" height="100" fill="var(--surface-2)" rx="4" />
        <polyline
          points={path.join(' ')}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <text x="0" y="110" fontSize="6" fill="var(--muted)">
          {formatShort(xMin)}
        </text>
        <text x="100" y="110" textAnchor="end" fontSize="6" fill="var(--muted)">
          {formatShort(xMax)}
        </text>
        <text x="50" y="110" textAnchor="middle" fontSize="6" fill="var(--muted)">
          {column}
        </text>
      </svg>
      <p className="text-xs text-muted">{t('ml.lab.insights.pdpHint')}</p>
    </div>
  );
}

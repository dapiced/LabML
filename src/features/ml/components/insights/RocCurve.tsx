import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/eyebrow';

export function RocCurve({ points, auc }: { points: { fpr: number; tpr: number }[]; auc: number }) {
  const { t } = useTranslation();
  const path = points.map((p) => `${(p.fpr * 100).toFixed(2)},${(100 - p.tpr * 100).toFixed(2)}`);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>{t('ml.lab.insights.rocTitle')}</Eyebrow>
        <Badge>AUC {auc.toFixed(3)}</Badge>
      </div>
      <svg
        viewBox="-8 -4 116 116"
        className="max-w-56"
        role="img"
        aria-label={t('ml.lab.insights.rocTitle')}
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
          points={path.join(' ')}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <text x="50" y="112" textAnchor="middle" fontSize="6" fill="var(--muted)">
          {t('ml.lab.insights.fpr')}
        </text>
        <text
          x="-4"
          y="50"
          textAnchor="middle"
          fontSize="6"
          fill="var(--muted)"
          transform="rotate(-90 -4 50)"
        >
          {t('ml.lab.insights.tpr')}
        </text>
      </svg>
    </div>
  );
}

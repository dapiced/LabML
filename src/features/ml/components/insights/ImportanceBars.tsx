import { useTranslation } from 'react-i18next';
import { Eyebrow } from '@/components/ui/eyebrow';

export function ImportanceBars({
  importance,
  isClassification,
}: {
  importance: { column: string; value: number }[];
  isClassification: boolean;
}) {
  const { t } = useTranslation();
  const top = importance.slice(0, 8);
  const peak = Math.max(...top.map((e) => Math.abs(e.value)), 1e-9);

  return (
    <div
      data-testid="importance"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4"
    >
      <Eyebrow>{t('ml.lab.insights.importanceTitle')}</Eyebrow>
      <div className="flex flex-col gap-1.5">
        {top.map(({ column, value }) => (
          <div
            key={column}
            className="flex items-center gap-2"
            title={`${column} : ${value.toFixed(4)}`}
          >
            <span className="w-28 shrink-0 truncate font-mono text-xs">{column}</span>
            <div className="h-2.5 flex-1 rounded-r-[2px] bg-surface-2">
              <div
                className="h-full rounded-r-[2px] bg-accent/75"
                style={{ width: `${Math.max(0, (value / peak) * 100)}%` }}
              />
            </div>
            <span className="w-14 shrink-0 text-right font-mono text-xs text-muted tabular-nums">
              {value >= 0 ? '+' : ''}
              {value.toFixed(3)}
            </span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">
        {isClassification
          ? t('ml.lab.insights.importanceHintClassification')
          : t('ml.lab.insights.importanceHintRegression')}
      </p>
    </div>
  );
}

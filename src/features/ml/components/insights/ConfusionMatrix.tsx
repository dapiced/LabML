import { useTranslation } from 'react-i18next';
import { Eyebrow } from '@/components/ui/eyebrow';

/**
 * Human-phrased confusion matrix: rows = actual, columns = predicted.
 * Cell tint scales with the share of its actual-class row.
 */
export function ConfusionMatrix({ classes, matrix }: { classes: string[]; matrix: number[][] }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <Eyebrow>{t('ml.lab.insights.confusionTitle')}</Eyebrow>
      <div className="overflow-x-auto">
        <table data-testid="confusion-matrix" className="text-sm tabular-nums">
          <thead>
            <tr>
              <th />
              {classes.map((label) => (
                <th
                  key={label}
                  className="px-2 pb-2 text-center font-mono text-[0.65rem] font-medium text-muted"
                >
                  {t('ml.lab.insights.predicted')} {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => {
              const rowTotal = row.reduce((a, v) => a + v, 0) || 1;
              return (
                <tr key={classes[i]}>
                  <th className="pr-2 text-right font-mono text-[0.65rem] font-medium whitespace-nowrap text-muted">
                    {t('ml.lab.insights.actual')} {classes[i]}
                  </th>
                  {row.map((count, j) => (
                    <td key={j} className="p-1">
                      <div
                        className="flex h-14 w-20 flex-col items-center justify-center rounded-lg"
                        style={{
                          background: `color-mix(in oklab, var(--accent) ${Math.round((count / rowTotal) * 60)}%, var(--surface-2))`,
                        }}
                        title={`${t('ml.lab.insights.actual')} ${classes[i]} → ${t('ml.lab.insights.predicted')} ${classes[j]} : ${count}`}
                      >
                        <span className="font-display text-lg font-semibold">{count}</span>
                        <span className="font-mono text-[0.6rem] text-muted">
                          {Math.round((count / rowTotal) * 100)}%
                        </span>
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

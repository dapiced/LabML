import { useTranslation } from 'react-i18next';
import { filledLines, readFilled } from '@/features/ml/train/filled';
import { cn } from '@/lib/utils';

/**
 * V71: the cells the encoder filled, per column. The same sentences go in the
 * report and the model card; a column that is mostly its fill value is said
 * to be so.
 */
export function FilledNotice({
  filled,
  className,
  scope = 'run',
}: {
  filled: unknown;
  className?: string;
  /** Whether the count is over the rows of a run or of a scored file. */
  scope?: 'run' | 'batch';
}) {
  const { t, i18n } = useTranslation();
  const lines = filledLines(readFilled(filled), t, i18n.resolvedLanguage ?? 'en');
  if (lines.length === 0) return null;
  return (
    <div className={cn('flex flex-col gap-1 text-xs', className)} data-testid="filled-notice">
      <p className="font-medium">{t(`ml.lab.filled.title.${scope}`)}</p>
      <ul className="flex flex-col gap-0.5">
        {lines.map((line) => (
          <li
            key={line.column}
            className={line.mostly ? 'text-copper' : 'text-muted'}
            data-testid={`filled-${line.column}`}
            data-mostly={line.mostly}
          >
            {line.text}
          </li>
        ))}
      </ul>
      <p className="max-w-3xl text-[0.68rem] text-muted">{t('ml.lab.filled.note')}</p>
    </div>
  );
}

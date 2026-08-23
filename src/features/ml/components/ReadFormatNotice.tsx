import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { PREVIEW_ROWS, isNonDefault } from '@/features/ml/data/locale';
import { useLabStore } from '@/features/ml/lab-store';

/**
 * V38: how the file was read, stated in plain language.
 *
 * It appears only when the reading was NOT the plain default — UTF-8, comma
 * delimiter, dot decimals. An ordinary file therefore pays nothing for this
 * feature: no extra card, no confirmation step, no friction. What justifies
 * the card is that the alternative is silence, and silence is what turned a
 * French export into a worse model without anyone noticing.
 *
 * Every claim here carries its own evidence: how many values proved a decimal
 * separator, and whether the encoding was a certainty (UTF-8 decoding threw)
 * or merely what the file declared.
 */
export function ReadFormatNotice() {
  const { t } = useTranslation();
  const readFormat = useLabStore((s) => s.readFormat);
  const preview = useLabStore((s) => s.preview);
  if (readFormat === null || !isNonDefault(readFormat)) return null;

  const delimiterLabel =
    readFormat.delimiter === '\t' ? t('ml.lab.read.tab') : `« ${readFormat.delimiter} »`;
  const rewritten = readFormat.decimalColumns;
  const previewColumns = Object.keys(preview[0] ?? {});

  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="read-format-notice">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-accent-strong" aria-hidden="true" />
        <span className="text-sm font-medium">{t('ml.lab.read.title')}</span>
      </div>

      <ul className="flex flex-col gap-1 text-xs text-muted">
        <li>{t('ml.lab.read.delimiter', { delimiter: delimiterLabel })}</li>
        <li>
          {readFormat.encoding.encoding === 'windows-1252'
            ? t('ml.lab.read.encodingFallback')
            : t('ml.lab.read.encodingUtf8')}
        </li>
        {rewritten.length > 0 && (
          <li data-testid="read-format-decimal">
            {t('ml.lab.read.decimal', {
              count: rewritten.length,
              columns: rewritten
                .map((column) => `${column.column} (${column.matched}/${column.total})`)
                .join(', '),
            })}
            {rewritten.some((column) => column.grouped) && ` ${t('ml.lab.read.grouped')}`}
          </li>
        )}
      </ul>

      {preview.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-[0.68rem]">
            <thead>
              <tr className="text-muted">
                {previewColumns.map((column) => (
                  <th key={column} className="px-2 py-1 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {preview.slice(0, PREVIEW_ROWS).map((row, index) => (
                <tr key={index} className="border-t border-line">
                  {previewColumns.map((column) => (
                    <td key={column} className="px-2 py-1">
                      {row[column]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted">{t('ml.lab.read.hint')}</p>
    </Card>
  );
}

export default ReadFormatNotice;

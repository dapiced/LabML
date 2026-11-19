/**
 * V71: the cells a run filled in, said out loud.
 *
 * The encoder has always replaced a missing or unreadable number by the
 * training median and a missing category by the most frequent one. It did so
 * without a count anywhere: on titanic `deck` is 77 % empty, under the 95 %
 * that would set it aside, so three quarters of what the models saw in that
 * column was "C", a value nobody recorded, and neither the run, the report
 * nor the model card said so.
 *
 * Nothing about the filling changes here, and no figure of any run moves.
 * This is the count, and the sentence that carries it wherever a run is
 * described.
 *
 * Measured before writing it (PLAN.md, V71): among the six demos titanic
 * fills `deck` (77 %) and `age` (20 %) and mpg `horsepower` (2 %). Keeping
 * `deck`, dropping it, or recoding it as known/unknown gives 0.813, 0.818 and
 * 0.817 of mean accuracy over ten seeds: inside the noise. So the mark below
 * is not a threshold on scores. It is a reading rule: past one half, most of
 * what the model reads in the column is its fill value.
 */
import type { FilledColumn } from '@/features/ml/train/pipeline';

/** Past this share of filled cells, a column is mostly its fill value. */
export const MOSTLY_FILLED = 0.5;

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * The filled columns of a summary, whatever it came from. A summary can
 * arrive through a share link: anything that does not have the shape the lab
 * writes is dropped rather than shown.
 */
export function readFilled(value: unknown): FilledColumn[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is FilledColumn => {
    if (typeof item !== 'object' || item === null) return false;
    const { column, rows, empty, unreadable, fill } = item as Record<string, unknown>;
    return (
      typeof column === 'string' &&
      isCount(rows) &&
      isCount(empty) &&
      isCount(unreadable) &&
      rows > 0 &&
      empty + unreadable > 0 &&
      empty + unreadable <= rows &&
      (fill === null || typeof fill === 'string')
    );
  });
}

export function filledShare(item: FilledColumn): number {
  return (item.empty + item.unreadable) / item.rows;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** One sentence per filled column, the mostly filled ones first. */
export function filledLines(
  filled: readonly FilledColumn[],
  t: Translate,
  lang: string,
): { column: string; text: string; mostly: boolean }[] {
  const int = (value: number) => value.toLocaleString(lang);
  return [...filled]
    .sort((a, b) => filledShare(b) - filledShare(a) || a.column.localeCompare(b.column))
    .map((item) => {
      const share = filledShare(item);
      const mostly = share > MOSTLY_FILLED;
      const what =
        item.unreadable === 0
          ? t('ml.lab.filled.empty', { count: item.empty, cells: int(item.empty) })
          : item.empty === 0
            ? t('ml.lab.filled.unreadable', {
                count: item.unreadable,
                cells: int(item.unreadable),
              })
            : t('ml.lab.filled.both', {
                empty: int(item.empty),
                unreadable: int(item.unreadable),
              });
      const text = [
        t('ml.lab.filled.line', {
          column: item.column,
          what,
          rows: int(item.rows),
          percent: (share * 100).toLocaleString(lang, { maximumFractionDigits: 0 }),
        }),
        item.fill === null
          ? t('ml.lab.filled.leftEmpty')
          : t('ml.lab.filled.filledWith', { value: item.fill }),
        ...(mostly ? [t('ml.lab.filled.mostly')] : []),
      ].join(' ');
      return { column: item.column, text, mostly };
    });
}

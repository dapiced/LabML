import { Loader2 } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useDataStore } from '@/features/data/data-store';
import type { RecipeOptions } from '@/features/data/quality/types';

type ToggleKey = Exclude<keyof RecipeOptions, 'missing'>;

const TOGGLES: ToggleKey[] = [
  'trimWhitespace',
  'mergeVariants',
  'dropDuplicates',
  'dropStructural',
  'clipOutliers',
];

/** The cleaning recipe: options on the left, their live effect on the right. */
export function RecipePanel() {
  const { t } = useTranslation();
  const options = useDataStore((s) => s.options);
  const stats = useDataStore((s) => s.stats);
  const applying = useDataStore((s) => s.applying);
  const setOptions = useDataStore((s) => s.setOptions);
  const missingId = useId();

  const effect = (key: ToggleKey): string | null => {
    if (!stats) return null;
    switch (key) {
      case 'trimWhitespace':
        return t('data.recipe.effects.cells', { count: stats.trimmedCells });
      case 'mergeVariants':
        return t('data.recipe.effects.cells', { count: stats.mergedCells });
      case 'dropDuplicates':
        return t('data.recipe.effects.rows', { count: stats.droppedDuplicateRows });
      case 'dropStructural':
        return stats.droppedColumns.length > 0
          ? t('data.recipe.effects.columnsList', {
              count: stats.droppedColumns.length,
              columns: stats.droppedColumns.join(', '),
            })
          : t('data.recipe.effects.columns', { count: 0 });
      case 'clipOutliers':
        return t('data.recipe.effects.cells', { count: stats.clippedCells });
    }
  };

  return (
    <section className="pb-12">
      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Eyebrow>{t('data.recipe.title')}</Eyebrow>
          {applying && (
            <Loader2
              className="h-4 w-4 animate-spin text-accent"
              aria-label={t('data.recipe.applying')}
            />
          )}
        </div>

        <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {TOGGLES.map((key) => (
            <label key={key} className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(e) => setOptions({ [key]: e.target.checked })}
                className="accent-(--accent) mt-1"
              />
              <span className="flex flex-col">
                <span className="font-medium">{t(`data.recipe.toggles.${key}`)}</span>
                {options[key] && effect(key) !== null && (
                  <span className="text-xs text-muted">{effect(key)}</span>
                )}
              </span>
            </label>
          ))}

          <div className="flex items-start gap-3 text-sm">
            <span className="flex flex-col gap-1">
              <label htmlFor={missingId} className="font-medium">
                {t('data.recipe.missing.label')}
              </label>
              <select
                id={missingId}
                value={options.missing}
                onChange={(e) =>
                  setOptions({ missing: e.target.value as RecipeOptions['missing'] })
                }
                className="w-fit rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
              >
                <option value="impute">{t('data.recipe.missing.impute')}</option>
                <option value="dropRows">{t('data.recipe.missing.dropRows')}</option>
                <option value="keep">{t('data.recipe.missing.keep')}</option>
              </select>
              {stats && options.missing === 'impute' && (
                <span className="text-xs text-muted">
                  {t('data.recipe.effects.cells', { count: stats.imputedCells })}
                </span>
              )}
              {stats && options.missing === 'dropRows' && (
                <span className="text-xs text-muted">
                  {t('data.recipe.effects.rows', { count: stats.droppedMissingRows })}
                </span>
              )}
            </span>
          </div>
        </div>

        {stats && (
          <p className="border-t border-line pt-3 text-sm text-muted" data-testid="recipe-result">
            {t('data.recipe.result', {
              rows: stats.rowCount.toLocaleString(),
              columns: stats.columnCount,
            })}
          </p>
        )}
      </Card>
    </section>
  );
}

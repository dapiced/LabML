import { FileUp, Loader2 } from 'lucide-react';
import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useDataStore } from '@/features/data/data-store';
import type { ForcedType, RecipeOptions } from '@/features/data/quality/types';

type ToggleKey = Exclude<keyof RecipeOptions, 'missing' | 'types'>;

const TOGGLES: ToggleKey[] = [
  'trimWhitespace',
  'mergeVariants',
  'dropDuplicates',
  'dropStructural',
  'clipOutliers',
  'deriveDates',
  'dropAnomalies',
];

/** The cleaning recipe: options on the left, their live effect on the right. */
export function RecipePanel() {
  const { t } = useTranslation();
  const options = useDataStore((s) => s.options);
  const stats = useDataStore((s) => s.stats);
  const applying = useDataStore((s) => s.applying);
  const setOptions = useDataStore((s) => s.setOptions);
  const columnTypes = useDataStore((s) => s.columnTypes);
  const recipeSource = useDataStore((s) => s.recipeSource);
  const recipeImportError = useDataStore((s) => s.recipeImportError);
  const importRecipe = useDataStore((s) => s.importRecipe);
  const importRef = useRef<HTMLInputElement>(null);
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
      case 'deriveDates':
        return stats.derivedColumns.length > 0
          ? t('data.recipe.effects.columnsAdded', {
              count: stats.derivedColumns.length,
              columns: stats.derivedColumns.join(', '),
            })
          : t('data.recipe.effects.columnsAddedNone');
      case 'dropAnomalies':
        return t('data.recipe.effects.rows', { count: stats.droppedAnomalyRows });
    }
  };

  return (
    <section className="pb-12">
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Eyebrow>{t('data.recipe.title')}</Eyebrow>
          {applying && (
            <Loader2
              className="h-4 w-4 animate-spin text-accent"
              aria-label={t('data.recipe.applying')}
            />
          )}
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            data-testid="recipe-import"
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs transition-colors hover:border-accent hover:bg-accent-soft"
          >
            <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
            {t('data.recipe.import')}
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            aria-label={t('data.recipe.import')}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importRecipe(file);
              e.target.value = '';
            }}
          />
        </div>
        {recipeSource && !recipeImportError && (
          <p className="text-xs text-muted" data-testid="recipe-imported">
            {t('data.recipe.imported', { name: recipeSource.name })}
            {recipeSource.exportedAt &&
              ` · ${t('data.recipe.importedAt', { date: recipeSource.exportedAt.slice(0, 10) })}`}
          </p>
        )}
        {recipeImportError && (
          <p className="text-xs text-copper" role="alert">
            {t('data.recipe.importError')}
          </p>
        )}

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

        <details className="text-sm">
          <summary className="cursor-pointer font-medium select-none">
            {t('data.recipe.typesTitle')}
          </summary>
          <p className="mt-1 max-w-3xl text-xs text-muted">{t('data.recipe.typesHint')}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(columnTypes).map(([name, inferred]) => (
              <label
                key={name}
                className="flex items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-1.5"
              >
                <span className="truncate font-mono text-xs">{name}</span>
                <select
                  value={options.types[name] ?? 'auto'}
                  onChange={(e) => {
                    const types = { ...options.types };
                    if (e.target.value === 'auto') delete types[name];
                    else types[name] = e.target.value as ForcedType;
                    setOptions({ types });
                  }}
                  className="rounded-lg border border-line bg-surface px-1.5 py-1 text-xs"
                >
                  <option value="auto">
                    {t('data.recipe.typeAuto', { type: t(`ml.lab.type.${inferred}`) })}
                  </option>
                  {(['numeric', 'categorical', 'text', 'date'] as const).map((forced) => (
                    <option key={forced} value={forced}>
                      {t(`ml.lab.type.${forced}`)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>

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

import { useLiveQuery } from 'dexie-react-hooks';
import { Check, FolderOpen, GitCompareArrows, HardDrive, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { db } from '@/features/ml/projects/db';
import { formatSize } from '@/features/ml/projects/dataset-storage';
import { useLabStore } from '@/features/ml/lab-store';
import { cn } from '@/lib/utils';
import type { RunRecord } from '@/features/ml/projects/types';
import { bestResult } from '@/features/ml/train/ranking';
import { MAX_RUNS } from '@/features/ml/projects/compare-many';

/** Datasets kept in the browser (v19) — reopen or forget, all local. */
function SavedDatasets() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const openDataset = useLabStore((s) => s.openDataset);
  const forgetDataset = useLabStore((s) => s.forgetDataset);
  // Project the CSV blobs away so the list never retains them in memory.
  const datasets = useLiveQuery(async () => {
    const list = await db.datasets.orderBy('savedAt').reverse().toArray();
    return list.map((d) => ({
      id: d.id!,
      name: d.name,
      rowCount: d.rowCount,
      columnCount: d.columnCount,
      storedBytes: d.storedBytes,
      savedAt: d.savedAt,
    }));
  }, []);

  if (!datasets || datasets.length === 0) return null;

  return (
    <Card data-testid="saved-datasets">
      <div className="flex flex-wrap items-baseline gap-3">
        <Eyebrow>{t('ml.lab.datasets.listTitle')}</Eyebrow>
        <span className="text-xs text-muted">{t('ml.lab.datasets.listNote')}</span>
      </div>
      <ul className="mt-4 flex flex-col">
        {datasets.map((dataset) => (
          <li
            key={dataset.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line py-2.5 text-sm first:border-t-0"
          >
            <HardDrive className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            <span className="font-mono font-medium">{dataset.name}</span>
            <span className="font-mono text-xs text-muted tabular-nums">
              {dataset.rowCount.toLocaleString(lang)} × {dataset.columnCount} ·{' '}
              {formatSize(
                dataset.storedBytes,
                lang,
                t('ml.lab.datasets.unitKb'),
                t('ml.lab.datasets.unitMb'),
              )}{' '}
              {t('ml.lab.datasets.stored')}
            </span>
            <span className="font-mono text-[0.68rem] text-muted">
              {new Date(dataset.savedAt).toLocaleString(lang)}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  openDataset(dataset.id);
                  window.scrollTo({ top: 0 });
                }}
                aria-label={t('ml.lab.datasets.reopen')}
                title={t('ml.lab.datasets.reopen')}
                className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => forgetDataset(dataset.id)}
                aria-label={t('ml.lab.datasets.forget')}
                title={t('ml.lab.datasets.forget')}
                className="rounded p-1.5 text-muted hover:bg-copper-soft hover:text-copper"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function bestOf(record: RunRecord) {
  // V35: same ranking rule as the leaderboard — validation when the run has
  // it, test otherwise. The history must not crown a different model.
  return bestResult(record.results, record.taskType) ?? undefined;
}

/** Local run history (IndexedDB) — rename, delete, view, compare two runs. */
export function RunsHistory() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const runs = useLiveQuery(() => db.runs.orderBy('createdAt').reverse().limit(20).toArray(), []);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');
  const [compare, setCompare] = useState<number[]>([]);

  if (!runs) return null;

  const compared = compare
    .map((id) => runs.find((r) => r.id === id))
    .filter((r): r is RunRecord => Boolean(r));

  // V37: up to MAX_RUNS selections, not two. Three or four runs answer a
  // different question — « which of the things I tried actually worked? »
  function toggleCompare(id: number) {
    setCompare((current) =>
      current.includes(id)
        ? current.filter((v) => v !== id)
        : [...current.slice(-(MAX_RUNS - 1)), id],
    );
  }

  async function commitRename(id: number) {
    const name = draftName.trim();
    if (name) await db.runs.update(id, { name });
    setEditingId(null);
  }

  return (
    <section data-testid="runs-history" className="flex flex-col gap-4 pb-12">
      <Card>
        <div className="flex flex-wrap items-baseline gap-3">
          <Eyebrow>{t('ml.lab.runs.title')}</Eyebrow>
          <span className="text-xs text-muted">{t('ml.lab.runs.note')}</span>
        </div>

        {runs.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t('ml.lab.runs.empty')}</p>
        ) : (
          <ul className="mt-4 flex flex-col">
            {runs.map((run) => {
              const best = bestOf(run);
              return (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line py-2.5 text-sm first:border-t-0"
                >
                  <input
                    type="checkbox"
                    checked={compare.includes(run.id!)}
                    onChange={() => toggleCompare(run.id!)}
                    aria-label={t('ml.lab.runs.compare')}
                    className="accent-(--accent)"
                  />
                  {editingId === run.id ? (
                    <span className="flex items-center gap-1">
                      <input
                        autoFocus
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void commitRename(run.id!)}
                        className="h-7 rounded-md border border-line bg-surface px-2 font-mono text-xs"
                        aria-label={t('ml.lab.runs.rename')}
                      />
                      <button
                        type="button"
                        onClick={() => void commitRename(run.id!)}
                        aria-label={t('ml.lab.runs.rename')}
                        className="rounded p-1 text-accent hover:bg-accent-soft"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </span>
                  ) : (
                    <Link
                      to={`/ml/run/${run.id}`}
                      className="font-medium hover:text-accent-strong hover:underline"
                    >
                      {run.name}
                    </Link>
                  )}
                  <span className="font-mono text-[0.68rem] text-muted">
                    {new Date(run.createdAt).toLocaleString(lang)}
                  </span>
                  <Badge variant="outline">
                    {t(`ml.lab.task.${run.taskType}`, {
                      count: run.insights.classes?.length ?? 0,
                    })}
                  </Badge>
                  {best && (
                    <span className="font-mono text-xs text-muted tabular-nums">
                      {t(`ml.lab.models.${best.key}`)} · {best.primary.toFixed(3)}
                    </span>
                  )}
                  {run.artifacts &&
                    (
                      [
                        'tuning',
                        'explanation',
                        'exploration',
                        'forecast',
                        'batchScore',
                        'threshold',
                        'segments',
                        'uncertainty',
                        'learningCurve',
                      ] as const
                    )
                      .filter((kind) => run.artifacts?.[kind])
                      .map((kind) => (
                        <Badge key={kind} variant="outline" className="text-[0.62rem]">
                          {t(`ml.lab.runArtifacts.chip.${kind}`)}
                        </Badge>
                      ))}
                  <span className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(run.id!);
                        setDraftName(run.name);
                      }}
                      aria-label={t('ml.lab.runs.rename')}
                      title={t('ml.lab.runs.rename')}
                      className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void db.runs.delete(run.id!)}
                      aria-label={t('ml.lab.runs.delete')}
                      title={t('ml.lab.runs.delete')}
                      className="rounded p-1.5 text-muted hover:bg-copper-soft hover:text-copper"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {compared.length === 2 && (
          <div className="mt-4">
            <Link
              to={`/ml/compare/${compared[0].id}/${compared[1].id}`}
              data-testid="compare-open"
              className={cn(buttonVariants({ size: 'sm' }))}
            >
              <GitCompareArrows className="h-4 w-4" aria-hidden="true" />
              {t('ml.lab.compare.open', { a: compared[0].name, b: compared[1].name })}
            </Link>
          </div>
        )}
        {compared.length > 2 && (
          <div className="mt-4">
            <Link
              to={`/ml/compare-many/${compared.map((r) => r.id).join('-')}`}
              data-testid="compare-many-open"
              className={cn(buttonVariants({ size: 'sm' }))}
            >
              <GitCompareArrows className="h-4 w-4" aria-hidden="true" />
              {t('ml.lab.compare.openMany', { count: compared.length })}
            </Link>
          </div>
        )}
      </Card>

      <SavedDatasets />
    </section>
  );
}

export default RunsHistory;

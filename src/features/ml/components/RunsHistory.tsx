import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { db } from '@/features/ml/projects/db';
import type { RunRecord } from '@/features/ml/projects/types';

function bestOf(record: RunRecord) {
  const ok = record.results.filter((r) => r.ok);
  const isClassification = record.taskType !== 'regression';
  return [...ok].sort((a, b) =>
    isClassification ? b.primary - a.primary : a.primary - b.primary,
  )[0];
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

  function toggleCompare(id: number) {
    setCompare((current) =>
      current.includes(id) ? current.filter((v) => v !== id) : [...current.slice(-1), id],
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
                    (['tuning', 'explanation', 'exploration', 'forecast', 'batchScore'] as const)
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
          <div className="mt-4 overflow-x-auto rounded-xl border border-line" data-testid="compare">
            <table className="w-full text-left text-sm tabular-nums">
              <thead>
                <tr className="bg-surface-2 font-mono text-[0.68rem] tracking-wider uppercase">
                  <th className="px-3 py-2 font-medium">{t('ml.lab.runs.compare')}</th>
                  {compared.map((run) => (
                    <th key={run.id} className="px-3 py-2 font-medium">
                      {run.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['dataset', (r: RunRecord) => r.dataset.name],
                    ['target', (r: RunRecord) => r.target],
                    [
                      'bestModel',
                      (r: RunRecord) => {
                        const best = bestOf(r);
                        return best ? t(`ml.lab.models.${best.key}`) : '—';
                      },
                    ],
                    ['primary', (r: RunRecord) => bestOf(r)?.primary.toFixed(3) ?? '—'],
                    ['rows', (r: RunRecord) => r.dataset.rowCount.toLocaleString(lang)],
                    ['seed', (r: RunRecord) => String(r.seed)],
                  ] as const
                ).map(([key, render]) => (
                  <tr key={key} className="border-t border-line">
                    <th className="px-3 py-2 text-left font-mono text-[0.68rem] text-muted uppercase">
                      {t(`ml.lab.runs.fields.${key}`)}
                    </th>
                    {compared.map((run) => (
                      <td key={run.id} className="px-3 py-2">
                        {render(run)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}

export default RunsHistory;

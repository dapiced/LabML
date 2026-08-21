import { Loader2, SlidersHorizontal, Square } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import {
  SEARCH_BUDGET,
  SEARCH_FOLDS,
  isTunable,
  type TunableKey,
} from '@/features/ml/train/search';
import { useLabStore } from '@/features/ml/lab-store';

function formatScore(value: number, isClassification: boolean, lang: string): string {
  return value.toLocaleString(lang, {
    minimumFractionDigits: 3,
    maximumFractionDigits: isClassification ? 3 : 3,
  });
}

/** Seeded random search + cross-validation, launched on demand after a run. */
export function TuningPanel() {
  const { t, i18n } = useTranslation();
  const trainStatus = useLabStore((s) => s.trainStatus);
  const results = useLabStore((s) => s.results);
  const tuneStatus = useLabStore((s) => s.tuneStatus);
  const tuneProgress = useLabStore((s) => s.tuneProgress);
  const outcome = useLabStore((s) => s.tuneOutcome);
  const tune = useLabStore((s) => s.tune);
  const cancelTune = useLabStore((s) => s.cancelTune);

  const tunable = results.filter((r) => r.ok && isTunable(r.key)).map((r) => r.key as TunableKey);
  const [model, setModel] = useState<TunableKey | ''>('');
  if (trainStatus !== 'done' || tunable.length === 0) return null;

  const selected = model || tunable[0];
  const lang = i18n.resolvedLanguage ?? 'en';
  const running = tuneStatus === 'running';
  const delta =
    outcome && Number.isFinite(outcome.defaultPrimary)
      ? outcome.isClassification
        ? outcome.tunedPrimary - outcome.defaultPrimary
        : outcome.defaultPrimary - outcome.tunedPrimary
      : null;

  return (
    <section
      data-testid="tuning"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
    >
      <div>
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-accent" aria-hidden="true" />
          <Eyebrow>{t('ml.lab.tuning.title')}</Eyebrow>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-muted">
          {t('ml.lab.tuning.hint', { budget: SEARCH_BUDGET, folds: SEARCH_FOLDS })}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          {t('ml.lab.tuning.model')}
          <select
            value={selected}
            onChange={(e) => setModel(e.target.value as TunableKey)}
            disabled={running}
            className="h-9 rounded-lg border border-line bg-surface px-2 text-sm"
          >
            {tunable.map((key) => (
              <option key={key} value={key}>
                {t(`ml.lab.models.${key}`)}
              </option>
            ))}
          </select>
        </label>
        {running ? (
          <Button variant="outline" size="sm" onClick={cancelTune}>
            <Square className="h-3.5 w-3.5" aria-hidden="true" />
            {t('ml.lab.tuning.cancel')}
          </Button>
        ) : (
          <Button size="sm" onClick={() => tune(selected)} data-testid="tune-start">
            {t('ml.lab.tuning.start')}
          </Button>
        )}
      </div>

      {running && (
        <div className="flex items-center gap-3 text-sm text-muted" aria-live="polite">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden="true" />
          {tuneProgress
            ? t('ml.lab.tuning.progress', {
                done: tuneProgress.done,
                total: tuneProgress.total,
              })
            : t('ml.lab.tuning.starting')}
          {tuneProgress && (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={tuneProgress.total}
              aria-valuenow={tuneProgress.done}
              className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-2"
            >
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${(tuneProgress.done / tuneProgress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {outcome && tuneStatus === 'done' && (
        <div className="flex flex-col gap-3 border-t border-line pt-3" data-testid="tune-result">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{t(`ml.lab.models.${outcome.model}`)} ·</span>
            {Object.entries(outcome.bestParams).map(([name, value]) => (
              <Badge key={name} variant="outline" className="font-mono">
                {name} = {value}
              </Badge>
            ))}
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-muted">
              {t('ml.lab.tuning.cvScore')}{' '}
              <span className="font-mono text-ink">
                {formatScore(outcome.bestCv, outcome.isClassification, lang)}
              </span>
            </span>
            <span className="text-muted">
              {t('ml.lab.tuning.testScore', {
                metric: outcome.isClassification ? 'accuracy' : 'RMSE',
              })}{' '}
              <span className="font-mono text-ink" data-testid="tune-test-score">
                {formatScore(outcome.tunedPrimary, outcome.isClassification, lang)}
              </span>
            </span>
            {delta !== null && (
              <span className="text-muted">
                {t('ml.lab.tuning.delta')}{' '}
                <span className={`font-mono ${delta >= 0 ? 'text-ok' : 'text-copper'}`}>
                  {delta >= 0 ? '+' : ''}
                  {formatScore(delta, outcome.isClassification, lang)}
                </span>
              </span>
            )}
          </div>

          <details className="text-xs text-muted">
            <summary className="cursor-pointer select-none">
              {t('ml.lab.tuning.trials', { count: outcome.trials.length })}
            </summary>
            <table className="mt-2 w-full max-w-xl text-left font-mono text-[0.68rem]">
              <thead>
                <tr className="border-b border-line">
                  <th className="py-1 pr-3 font-normal">{t('ml.lab.tuning.paramsHeader')}</th>
                  <th className="py-1 font-normal">CV</th>
                </tr>
              </thead>
              <tbody>
                {outcome.trials.map((trial, index) => (
                  <tr key={index} className="border-b border-line last:border-b-0">
                    <td className="py-1 pr-3">
                      {Object.entries(trial.params)
                        .map(([name, value]) => `${name}=${value}`)
                        .join(' · ')}
                    </td>
                    <td className="py-1 tabular-nums">
                      {formatScore(trial.cvScore, outcome.isClassification, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          <p className="text-xs text-muted">{t('ml.lab.tuning.note')}</p>
        </div>
      )}
    </section>
  );
}

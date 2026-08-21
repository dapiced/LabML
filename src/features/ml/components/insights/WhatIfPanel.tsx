import { Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useLabStore } from '@/features/ml/lab-store';

/** Interactive single-row prediction against the inspected model. */
export function WhatIfPanel() {
  const { t, i18n } = useTranslation();
  const profiles = useLabStore((s) => s.profiles);
  const summary = useLabStore((s) => s.summary);
  const insights = useLabStore((s) => s.insights);
  const whatIf = useLabStore((s) => s.whatIf);
  const requestWhatIf = useLabStore((s) => s.requestWhatIf);
  const explanation = useLabStore((s) => s.explanation);
  const requestExplanation = useLabStore((s) => s.requestExplanation);

  const featureProfiles = useMemo(
    () => (summary?.featureColumns ?? []).map((name) => profiles.find((p) => p.name === name)!),
    [summary, profiles],
  );

  const defaults = useMemo(() => {
    const record: Record<string, string> = {};
    for (const profile of featureProfiles) {
      record[profile.name] = profile.numeric
        ? String(profile.numeric.median)
        : (profile.topValues?.[0]?.value ?? '');
    }
    return record;
  }, [featureProfiles]);

  // The parent remounts this panel (via `key`) when the inspected model or the
  // feature set changes, so initializing from the defaults once is enough.
  const [values, setValues] = useState(defaults);

  const model = insights?.model;
  useEffect(() => {
    if (!model) return;
    const handle = setTimeout(() => requestWhatIf(values), 250);
    return () => clearTimeout(handle);
  }, [values, model, requestWhatIf]);

  if (!summary || !insights) return null;

  return (
    <div
      data-testid="what-if"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
    >
      <div>
        <Eyebrow>{t('ml.lab.insights.whatIfTitle')}</Eyebrow>
        <p className="mt-1 text-xs text-muted">{t('ml.lab.insights.whatIfHint')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {featureProfiles.map((profile) => (
          <label key={profile.name} className="flex flex-col gap-1">
            <span className="truncate font-mono text-[0.68rem] text-muted">{profile.name}</span>
            {profile.numeric ? (
              <input
                type="number"
                step="any"
                value={values[profile.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [profile.name]: e.target.value }))}
                className="h-9 rounded-lg border border-line bg-surface px-2 font-mono text-sm"
              />
            ) : (
              <select
                value={values[profile.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [profile.name]: e.target.value }))}
                className="h-9 rounded-lg border border-line bg-surface px-2 font-mono text-sm"
              >
                {(profile.topValues ?? []).map(({ value }) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            )}
          </label>
        ))}
      </div>

      {whatIf && whatIf.model === insights.model && (
        <div className="flex flex-wrap items-center gap-4 border-t border-line pt-3">
          <span className="flex items-center gap-2 text-sm">
            {t('ml.lab.insights.whatIfPrediction')}
            <Badge data-testid="what-if-prediction" className="text-sm">
              {whatIf.prediction}
            </Badge>
          </span>
          {!explanation && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => requestExplanation(values)}
              data-testid="explain-button"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {t('ml.lab.insights.explainButton')}
            </Button>
          )}
          {whatIf.probabilities && (
            <div className="flex flex-1 flex-col gap-1">
              {whatIf.probabilities.slice(0, 3).map(({ label, p }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 truncate font-mono text-[0.65rem] text-muted">
                    {label}
                  </span>
                  <div className="h-2 max-w-48 flex-1 rounded-r-[2px] bg-surface-2">
                    <div
                      className="h-full rounded-r-[2px] bg-accent/75"
                      style={{ width: `${p * 100}%` }}
                    />
                  </div>
                  <span className="font-mono text-[0.65rem] text-muted tabular-nums">
                    {(p * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {explanation && explanation.model === insights.model && (
        <div className="flex flex-col gap-2 border-t border-line pt-3" data-testid="explanation">
          <p className="text-xs font-medium">
            {explanation.targetClass
              ? t('ml.lab.insights.explainTitleClass', { class: explanation.targetClass })
              : t('ml.lab.insights.explainTitle')}
          </p>
          <ul className="flex flex-col gap-1.5">
            {explanation.contributions.slice(0, 8).map(({ column, value }) => {
              const max = Math.max(
                ...explanation.contributions.map((c) => Math.abs(c.value)),
                1e-12,
              );
              const width = (Math.abs(value) / max) * 50;
              const display = explanation.usedProba
                ? `${value >= 0 ? '+' : '−'}${(Math.abs(value) * 100).toLocaleString(
                    i18n.resolvedLanguage,
                    { maximumFractionDigits: 1 },
                  )} pt`
                : `${value >= 0 ? '+' : '−'}${Math.abs(value).toLocaleString(
                    i18n.resolvedLanguage,
                    { maximumFractionDigits: 3 },
                  )}`;
              return (
                <li key={column} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 truncate font-mono text-[0.65rem] text-muted">
                    {column}
                  </span>
                  <div className="relative h-2.5 flex-1 max-w-72 rounded-[2px] bg-surface-2">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-line" aria-hidden="true" />
                    <div
                      className={`absolute inset-y-0 ${value >= 0 ? 'left-1/2 rounded-r-[2px] bg-accent/80' : 'right-1/2 rounded-l-[2px] bg-copper/80'}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right font-mono text-[0.65rem] text-muted tabular-nums">
                    {display}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-[0.68rem] text-muted">
            {t('ml.lab.insights.explainNote', {
              permutations: explanation.permutations,
              references: explanation.references,
            })}
          </p>
        </div>
      )}
    </div>
  );
}

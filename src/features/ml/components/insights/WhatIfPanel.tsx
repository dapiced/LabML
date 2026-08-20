import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useLabStore } from '@/features/ml/lab-store';

/** Interactive single-row prediction against the inspected model. */
export function WhatIfPanel() {
  const { t } = useTranslation();
  const profiles = useLabStore((s) => s.profiles);
  const summary = useLabStore((s) => s.summary);
  const insights = useLabStore((s) => s.insights);
  const whatIf = useLabStore((s) => s.whatIf);
  const requestWhatIf = useLabStore((s) => s.requestWhatIf);

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
    </div>
  );
}

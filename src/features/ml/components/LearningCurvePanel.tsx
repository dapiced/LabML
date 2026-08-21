import { Loader2, Square, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useLabStore } from '@/features/ml/lab-store';
import type { LearningCurveOutcome } from '@/features/ml/train/learning-curve';
import type { ModelKey } from '@/features/ml/train/types';

function compact(n: number, lang: string): string {
  if (n >= 10_000) return `${Math.round(n / 1000).toLocaleString(lang)}k`;
  if (n >= 1_000) return `${(n / 1000).toLocaleString(lang, { maximumFractionDigits: 1 })}k`;
  return n.toLocaleString(lang);
}

/**
 * Metric vs training size: one line, its 95% bootstrap band, one dot per
 * announced sample size. X positions are log-spaced (the ladder is
 * geometric); the y-window fits the intervals with a little padding.
 */
export function CurveChart({ outcome, lang }: { outcome: LearningCurveOutcome; lang: string }) {
  const { points } = outcome;
  const xs = points.map((p) => Math.log(p.rows));
  const xMin = xs[0];
  const xSpan = Math.max(xs[xs.length - 1] - xMin, 1e-9);
  const yLo = Math.min(...points.map((p) => p.lo));
  const yHi = Math.max(...points.map((p) => p.hi));
  const pad = Math.max((yHi - yLo) * 0.15, 1e-9);
  const y0 = yLo - pad;
  const ySpan = yHi + pad - y0;
  const sx = (rows: number) => 8 + ((Math.log(rows) - xMin) / xSpan) * 84;
  const sy = (v: number) => 50 - ((v - y0) / ySpan) * 42;

  const band = [
    ...points.map((p) => `${sx(p.rows)},${sy(p.hi)}`),
    ...[...points].reverse().map((p) => `${sx(p.rows)},${sy(p.lo)}`),
  ].join(' ');
  const line = points.map((p) => `${sx(p.rows)},${sy(p.metric)}`).join(' ');

  return (
    <svg viewBox="0 0 100 60" className="h-auto w-full max-w-2xl" aria-hidden="true">
      <rect x="0" y="0" width="100" height="60" fill="var(--surface)" rx="2" />
      <line x1="8" y1="50" x2="92" y2="50" stroke="var(--line)" strokeWidth="0.3" />
      <polygon points={band} fill="var(--accent)" opacity="0.14" />
      <polyline
        points={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
      {points.map((p) => (
        <g key={p.rows}>
          <circle cx={sx(p.rows)} cy={sy(p.metric)} r="1.1" fill="var(--accent)" />
          <text
            x={sx(p.rows)}
            y="55"
            textAnchor="middle"
            fontSize="2.6"
            fill="var(--muted)"
            fontFamily="var(--font-mono)"
          >
            {compact(p.rows, lang)}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** V26: "would more data help?" — the learning curve, launched on demand. */
export function LearningCurvePanel() {
  const { t, i18n } = useTranslation();
  const trainStatus = useLabStore((s) => s.trainStatus);
  const results = useLabStore((s) => s.results);
  const summary = useLabStore((s) => s.summary);
  const curveStatus = useLabStore((s) => s.curveStatus);
  const curveProgress = useLabStore((s) => s.curveProgress);
  const outcome = useLabStore((s) => s.curveOutcome);
  const learningCurve = useLabStore((s) => s.learningCurve);
  const cancelCurve = useLabStore((s) => s.cancelCurve);

  // The baseline is flat by definition — every other completed model curves.
  const eligible = results.filter((r) => r.ok && r.key !== 'baseline').map((r) => r.key);
  const [model, setModel] = useState<ModelKey | ''>('');
  if (trainStatus !== 'done' || eligible.length === 0) return null;

  const selected = model || eligible[0];
  const lang = i18n.resolvedLanguage ?? 'en';
  const running = curveStatus === 'running';
  const fmt = (v: number) =>
    v.toLocaleString(lang, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const rows = (v: number) => v.toLocaleString(lang);

  const last = outcome?.points[outcome.points.length - 1];
  const previous = outcome?.points[outcome.points.length - 2];

  return (
    <section
      data-testid="learning-curve"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
    >
      <div>
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-accent" aria-hidden="true" />
          <Eyebrow>{t('ml.lab.curve.title')}</Eyebrow>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-muted">{t('ml.lab.curve.hint')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          {t('ml.lab.curve.model')}
          <select
            value={selected}
            onChange={(e) => setModel(e.target.value as ModelKey)}
            disabled={running}
            className="h-9 rounded-lg border border-line bg-surface px-2 text-sm"
          >
            {eligible.map((key) => (
              <option key={key} value={key}>
                {t(`ml.lab.models.${key}`)}
              </option>
            ))}
          </select>
        </label>
        {running ? (
          <Button variant="outline" size="sm" onClick={cancelCurve}>
            <Square className="h-3.5 w-3.5" aria-hidden="true" />
            {t('ml.lab.curve.cancel')}
          </Button>
        ) : (
          <Button size="sm" onClick={() => learningCurve(selected)} data-testid="curve-start">
            {t('ml.lab.curve.start')}
          </Button>
        )}
      </div>

      {running && (
        <div className="flex items-center gap-3 text-sm text-muted" aria-live="polite">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden="true" />
          {curveProgress
            ? t('ml.lab.curve.progress', {
                done: curveProgress.done,
                total: curveProgress.total,
              })
            : t('ml.lab.curve.starting')}
        </div>
      )}

      {curveStatus === 'done' && !outcome && (
        <p className="text-sm text-muted">{t('ml.lab.curve.refused')}</p>
      )}

      {outcome && curveStatus === 'done' && last && previous && (
        <div className="flex flex-col gap-3 border-t border-line pt-3" data-testid="curve-result">
          <p className="font-mono text-[0.68rem] text-muted">
            {t('ml.lab.curve.axis', {
              model: t(`ml.lab.models.${outcome.model}`),
              metric: t(`ml.lab.leaderboard.${outcome.metricLabel}`),
              test: rows(outcome.testRows),
            })}
          </p>
          <CurveChart outcome={outcome} lang={lang} />

          <p className="max-w-3xl text-sm" data-testid="curve-verdict">
            {outcome.verdict.kind === 'climbing'
              ? t('ml.lab.curve.climbing', {
                  from: rows(previous.rows),
                  to: rows(last.rows),
                  gain: fmt(outcome.verdict.gain),
                  lo: fmt(outcome.verdict.lo),
                  hi: fmt(outcome.verdict.hi),
                })
              : t('ml.lab.curve.plateau', {
                  from: rows(previous.rows),
                  to: rows(last.rows),
                  gain: fmt(outcome.verdict.gain),
                })}{' '}
            {outcome.cappedAt !== undefined &&
              (outcome.verdict.kind === 'climbing'
                ? t('ml.lab.curve.capCost', { cap: rows(outcome.cappedAt) })
                : t('ml.lab.curve.capFree', { cap: rows(outcome.cappedAt) }))}
          </p>

          <details className="text-xs text-muted">
            <summary className="cursor-pointer select-none">
              {t('ml.lab.curve.pointsTable', { count: outcome.points.length })}
            </summary>
            <table className="mt-2 w-full max-w-xl text-left font-mono text-[0.68rem]">
              <thead>
                <tr className="border-b border-line">
                  <th className="py-1 pr-3 font-normal">{t('ml.lab.curve.colRows')}</th>
                  <th className="py-1 pr-3 font-normal">
                    {t(`ml.lab.leaderboard.${outcome.metricLabel}`)}
                  </th>
                  <th className="py-1 font-normal">{t('ml.lab.uncertainty.interval')}</th>
                </tr>
              </thead>
              <tbody>
                {outcome.points.map((p) => (
                  <tr key={p.rows} className="border-b border-line last:border-b-0">
                    <td className="py-1 pr-3 tabular-nums">{rows(p.rows)}</td>
                    <td className="py-1 pr-3 tabular-nums">{fmt(p.metric)}</td>
                    <td className="py-1 tabular-nums">
                      [{fmt(p.lo)} ; {fmt(p.hi)}]
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          <p className="max-w-3xl text-xs text-muted">
            {t('ml.lab.curve.note', {
              trainRows: rows(summary?.trainRows ?? outcome.trainRows),
            })}
          </p>
        </div>
      )}
    </section>
  );
}

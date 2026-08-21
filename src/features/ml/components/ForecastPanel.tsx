import { CalendarClock, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useLabStore } from '@/features/ml/lab-store';
import type { ForecastPayload } from '@/features/ml/timeseries/run';

function ForecastChart({ payload }: { payload: ForecastPayload }) {
  const all = [
    ...payload.points.map((p) => ({ t: p.t, values: [p.y] })),
    ...payload.forecast.map((p) => ({ t: p.t, values: [p.yhat, p.lo, p.hi] })),
  ];
  const minT = all[0].t;
  const maxT = all[all.length - 1].t;
  const ys = all.flatMap((p) => p.values);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const sx = (t: number) => 3 + ((t - minT) / (maxT - minT || 1)) * 94;
  const sy = (y: number) => 55 - ((y - minY) / (maxY - minY || 1)) * 50;

  const history = payload.points.map((p) => `${sx(p.t)},${sy(p.y)}`).join(' ');
  const bridge = payload.points[payload.points.length - 1];
  const forecastLine = [
    `${sx(bridge.t)},${sy(bridge.y)}`,
    ...payload.forecast.map((p) => `${sx(p.t)},${sy(p.yhat)}`),
  ].join(' ');
  const band = [
    ...payload.forecast.map((p) => `${sx(p.t)},${sy(p.hi)}`),
    ...[...payload.forecast].reverse().map((p) => `${sx(p.t)},${sy(p.lo)}`),
  ].join(' ');

  return (
    <svg viewBox="0 0 100 60" className="h-auto w-full" aria-hidden="true">
      <rect x="0" y="0" width="100" height="60" fill="var(--surface)" rx="2" />
      <polygon points={band} fill="var(--copper)" opacity="0.15" />
      <polyline
        points={history}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
      <polyline
        points={forecastLine}
        fill="none"
        stroke="var(--copper)"
        strokeWidth="0.7"
        strokeDasharray="1.6 1.2"
        strokeLinejoin="round"
      />
      <line
        x1={sx(bridge.t)}
        y1="4"
        x2={sx(bridge.t)}
        y2="56"
        stroke="var(--line)"
        strokeWidth="0.3"
      />
    </svg>
  );
}

/** Time-series forecasting, offered when the dataset carries a date column. */
export function ForecastPanel() {
  const { t, i18n } = useTranslation();
  const status = useLabStore((s) => s.status);
  const profiles = useLabStore((s) => s.profiles);
  const forecastStatus = useLabStore((s) => s.forecastStatus);
  const payload = useLabStore((s) => s.forecastPayload);
  const forecast = useLabStore((s) => s.forecast);

  const dateColumns = profiles.filter((p) => p.type === 'date').map((p) => p.name);
  const valueColumns = profiles.filter((p) => p.type === 'numeric').map((p) => p.name);
  const [dateColumn, setDateColumn] = useState('');
  const [valueColumn, setValueColumn] = useState('');
  if (status !== 'ready' || dateColumns.length === 0 || valueColumns.length === 0) return null;

  const lang = i18n.resolvedLanguage;
  const selectedDate = dateColumn || dateColumns[0];
  const selectedValue = valueColumn || valueColumns[0];
  const running = forecastStatus === 'running';
  const num = (v: number) => v.toLocaleString(lang, { maximumFractionDigits: 2 });
  const day = (ms: number) =>
    new Date(ms).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <section
      data-testid="forecast"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
    >
      <div>
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-accent" aria-hidden="true" />
          <Eyebrow>{t('ml.lab.forecast.title')}</Eyebrow>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-muted">{t('ml.lab.forecast.hint')}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t('ml.lab.forecast.dateColumn')}
          <select
            value={selectedDate}
            onChange={(e) => setDateColumn(e.target.value)}
            disabled={running}
            className="h-9 rounded-lg border border-line bg-surface px-2 font-mono text-sm"
          >
            {dateColumns.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('ml.lab.forecast.valueColumn')}
          <select
            value={selectedValue}
            onChange={(e) => setValueColumn(e.target.value)}
            disabled={running}
            className="h-9 rounded-lg border border-line bg-surface px-2 font-mono text-sm"
          >
            {valueColumns.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          onClick={() => forecast(selectedDate, selectedValue)}
          disabled={running}
          data-testid="forecast-start"
        >
          {t('ml.lab.forecast.start')}
        </Button>
        {running && (
          <span className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
            {t('ml.lab.forecast.running')}
          </span>
        )}
      </div>

      {forecastStatus === 'done' && payload && (
        <div className="flex flex-col gap-4" data-testid="forecast-result">
          <p className="text-sm text-muted">
            {t('ml.lab.forecast.summary', {
              points: payload.totalPoints.toLocaleString(lang),
              freq: t(`ml.lab.forecast.freq.${payload.freq}`),
              holdout: payload.holdout,
              winner: t(`ml.lab.forecast.methods.${payload.winner.key}`),
              mae: num(payload.winner.mae),
              naive: num(payload.naiveMae),
            })}
            {payload.seasonalPeriod !== undefined &&
              ` ${t('ml.lab.forecast.seasonNote', { m: payload.seasonalPeriod })}`}
          </p>

          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="flex flex-col gap-1.5">
              <ForecastChart payload={payload} />
              <div className="flex flex-wrap items-center gap-4 text-[0.68rem] text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-5 bg-accent" aria-hidden="true" />
                  {t('ml.lab.forecast.legendHistory', {
                    from: day(payload.points[0].t),
                    to: day(payload.points[payload.points.length - 1].t),
                  })}
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-0.5 w-5 bg-copper"
                    style={{
                      maskImage:
                        'repeating-linear-gradient(90deg, black 0 4px, transparent 4px 7px)',
                    }}
                    aria-hidden="true"
                  />
                  {t('ml.lab.forecast.legendForecast', {
                    count: payload.forecast.length,
                    to: day(payload.forecast[payload.forecast.length - 1].t),
                  })}
                </span>
              </div>
            </div>

            <table className="h-fit w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-1 pr-2 font-normal">{t('ml.lab.forecast.methodHeader')}</th>
                  <th className="py-1 pr-2 font-normal">MAE</th>
                  <th className="py-1 font-normal">RMSE</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {payload.methods.map((method) => (
                  <tr key={method.key} className="border-b border-line last:border-b-0">
                    <td className="py-1 pr-2 font-sans">
                      {t(`ml.lab.forecast.methods.${method.key}`)}
                      {method.key === payload.winner.key && (
                        <span className="ml-1 text-accent-strong">★</span>
                      )}
                    </td>
                    <td className="py-1 pr-2 tabular-nums">{num(method.mae)}</td>
                    <td className="py-1 tabular-nums">{num(method.rmse)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted">{t('ml.lab.forecast.note')}</p>
        </div>
      )}
    </section>
  );
}

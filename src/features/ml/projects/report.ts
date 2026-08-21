import { METRIC_ROWS, metricDelta } from '@/features/ml/train/score-view';
import type { RunRecord } from '@/features/ml/projects/types';
import type { ClusterTrait } from '@/features/ml/unsupervised/explore';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The rule-generated plain-language summary — shared by the in-app card and
 * the exported report so both always tell the same story.
 */
export function buildPlainRead(record: RunRecord, t: Translate, lang: string): string {
  const { results, summary, insights } = record;
  const result = results.find((r) => r.key === insights.model);
  const baseline = results.find((r) => r.key === 'baseline');
  if (!result?.ok) return '';

  const pct = (v: number) => (v * 100).toLocaleString(lang, { maximumFractionDigits: 1 });
  const num = (v: number) => v.toLocaleString(lang, { maximumFractionDigits: 2 });
  const modelName = t(`ml.lab.models.${insights.model}`);
  const isClassification = summary.taskType !== 'regression';
  const sentences: string[] = [];

  if (isClassification) {
    sentences.push(
      t('ml.lab.insights.readAccuracy', {
        model: modelName,
        accuracy: pct(result.metrics.accuracy ?? 0),
        rows: summary.testRows,
      }),
    );
    if (baseline?.ok && baseline.key !== result.key) {
      sentences.push(
        t('ml.lab.insights.readBaseline', {
          delta: pct((result.metrics.accuracy ?? 0) - (baseline.metrics.accuracy ?? 0)),
          baseline: pct(baseline.metrics.accuracy ?? 0),
        }),
      );
    }
    if (insights.classes?.length === 2 && insights.confusion) {
      const positiveRow = insights.confusion[1];
      const total = positiveRow.reduce((a, v) => a + v, 0);
      if (total > 0) {
        sentences.push(
          t('ml.lab.insights.readRecall', {
            recall: pct(positiveRow[1] / total),
            label: insights.classes[1],
          }),
        );
      }
    }
  } else {
    sentences.push(
      t('ml.lab.insights.readRegression', {
        model: modelName,
        mae: num(result.metrics.mae ?? 0),
        rows: summary.testRows,
      }),
    );
    sentences.push(
      t('ml.lab.insights.readVariance', { r2: pct(Math.max(0, result.metrics.r2 ?? 0)) }),
    );
  }

  const drivers = insights.importance
    .filter((entry) => entry.value > 0)
    .slice(0, 3)
    .map((entry) => entry.column);
  if (drivers.length > 0) {
    sentences.push(t('ml.lab.insights.readDrivers', { columns: drivers.join(', ') }));
  }
  return sentences.join(' ');
}

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const fmt = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? '—' : v.toFixed(3));

function traitText(trait: ClusterTrait, t: Translate, lang: string): string {
  const num = (v: number) => v.toLocaleString(lang, { maximumFractionDigits: 2 });
  const pct = (v: number) => (v * 100).toLocaleString(lang, { maximumFractionDigits: 0 });
  return trait.kind === 'numeric'
    ? t('ml.lab.explore.traitNumeric', {
        column: trait.column,
        clusterMean: num(trait.clusterMean),
        overallMean: num(trait.overallMean),
      })
    : t('ml.lab.explore.traitCategorical', {
        column: trait.column,
        value: trait.value,
        share: pct(trait.share),
        overallShare: pct(trait.overallShare),
      });
}

/**
 * The analyses that joined the run after training — same numbers as the
 * in-app panels, rendered as print-friendly tables.
 */
function artifactSections(record: RunRecord, t: Translate, lang: string): string {
  const { artifacts } = record;
  if (!artifacts) return '';
  const sections: string[] = [];

  if (artifacts.tuning) {
    const tuning = artifacts.tuning;
    const params = Object.entries(tuning.bestParams)
      .map(([name, value]) => `${name} = ${value}`)
      .join(' · ');
    const delta = Number.isFinite(tuning.defaultPrimary)
      ? tuning.isClassification
        ? tuning.tunedPrimary - tuning.defaultPrimary
        : tuning.defaultPrimary - tuning.tunedPrimary
      : null;
    sections.push(`<h2>${esc(t('ml.lab.tuning.title'))} — ${esc(t(`ml.lab.models.${tuning.model}`))}</h2>
    <p class="meta">${esc(params)}</p>
    <table><tr><th>${esc(t('ml.lab.tuning.cvScore'))}</th><th>${esc(
      t('ml.lab.tuning.testScore', { metric: tuning.isClassification ? 'accuracy' : 'RMSE' }),
    )}</th><th>${esc(t('ml.lab.tuning.delta'))}</th></tr>
    <tr><td>${fmt(tuning.bestCv)}</td><td>${fmt(tuning.tunedPrimary)}</td>
    <td>${delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(3)}`}</td></tr></table>`);
  }

  if (artifacts.explanation) {
    const explanation = artifacts.explanation;
    const title = explanation.targetClass
      ? t('ml.lab.insights.explainTitleClass', { class: explanation.targetClass })
      : t('ml.lab.insights.explainTitle');
    sections.push(`<h2>${esc(title)}</h2>
    <p class="meta">${fmt(explanation.baseline)} → ${fmt(explanation.prediction)} (${esc(
      t(`ml.lab.models.${explanation.model}`),
    )})</p>
    <table><tr><th>${esc(t('ml.lab.leaderboard.model'))}</th><th>Δ</th></tr>
    ${explanation.contributions
      .slice(0, 8)
      .map(
        (entry) =>
          `<tr><td>${esc(entry.column)}</td><td>${entry.value >= 0 ? '+' : ''}${entry.value.toFixed(3)}</td></tr>`,
      )
      .join('\n')}</table>`);
  }

  if (artifacts.exploration) {
    const exploration = artifacts.exploration;
    sections.push(`<h2>${esc(t('ml.lab.explore.title'))}</h2>
    <p class="meta">${esc(
      t('ml.lab.explore.summary', {
        k: exploration.k,
        silhouette: exploration.silhouette.toLocaleString(lang, { maximumFractionDigits: 2 }),
        tried: exploration.tried.map((entry) => entry.k).join(', '),
        rows: exploration.rowsUsed.toLocaleString(lang),
        p1: (exploration.explained[0] * 100).toLocaleString(lang, { maximumFractionDigits: 0 }),
        p2: (exploration.explained[1] * 100).toLocaleString(lang, { maximumFractionDigits: 0 }),
      }),
    )}</p>
    <table>${exploration.clusters
      .map(
        (
          cluster,
        ) => `<tr><th>${esc(t('ml.lab.explore.clusterName', { id: cluster.id + 1 }))}<br>${esc(
          t('ml.lab.explore.clusterSize', {
            count: cluster.size,
            share: (cluster.share * 100).toLocaleString(lang, { maximumFractionDigits: 0 }),
          }),
        )}</th>
        <td>${cluster.traits.map((trait) => esc(traitText(trait, t, lang))).join('<br>')}</td></tr>`,
      )
      .join('\n')}</table>`);
  }

  if (artifacts.threshold) {
    const th = artifacts.threshold;
    sections.push(`<h2>${esc(t('ml.lab.threshold.title'))} — ${esc(t(`ml.lab.models.${th.model}`))}</h2>
    <p class="meta">${esc(
      t('ml.lab.threshold.hint', {
        positive: th.positiveClass,
        rate: (th.positiveRate * 100).toLocaleString(lang, { maximumFractionDigits: 1 }),
      }),
    )}</p>
    <table><tr><th>AP</th><th>Brier</th><th>${esc(t('ml.lab.threshold.threshold'))}</th><th>FP/FN</th>
    <th>${esc(t('ml.lab.threshold.precision'))}</th><th>${esc(t('ml.lab.threshold.recall'))}</th><th>F1</th><th>${esc(
      t('ml.lab.threshold.cost'),
    )}</th></tr>
    <tr><td>${fmt(th.averagePrecision)}</td><td>${fmt(th.brier)}</td><td>${th.chosen.threshold.toFixed(2)}</td>
    <td>${th.chosen.costFp} / ${th.chosen.costFn}</td><td>${fmt(th.chosen.precision)}</td><td>${fmt(
      th.chosen.recall,
    )}</td><td>${fmt(th.chosen.f1)}</td><td>${th.chosen.cost}</td></tr></table>`);
  }

  if (artifacts.segments) {
    const seg = artifacts.segments;
    const metricName = t(`ml.lab.leaderboard.${seg.metricLabel}`);
    const rows = seg.columns
      .flatMap((column) =>
        column.segments.map(
          (segment) =>
            `<tr><td>${esc(column.column)}</td><td>${esc(segment.value)}</td><td>${segment.rows}</td>` +
            `<td>${fmt(segment.metric)}</td><td>${segment.delta >= 0 ? '+' : ''}${segment.delta.toFixed(3)}</td></tr>`,
        ),
      )
      .join('\n');
    sections.push(`<h2>${esc(t('ml.lab.segments.title'))} — ${esc(t(`ml.lab.models.${seg.model}`))}</h2>
    <p class="meta">${esc(
      t('ml.lab.segments.hint', {
        rows: seg.testRows.toLocaleString(lang),
        min: seg.minRows,
      }),
    )} ${esc(metricName)} ${fmt(seg.overall)}.</p>
    <table><tr><th>${esc(t('ml.lab.segments.colColumn'))}</th><th>${esc(
      t('ml.lab.segments.colSegment'),
    )}</th><th>${esc(t('ml.lab.segments.colRows'))}</th><th>${esc(metricName)}</th><th>${esc(
      t('ml.lab.segments.colDelta'),
    )}</th></tr>
    ${rows}</table>`);
  }

  if (artifacts.batchScore) {
    const batch = artifacts.batchScore;
    const rows = batch.metrics
      ? METRIC_ROWS.filter(
          ({ key }) => batch.metrics![key] !== undefined && batch.testMetrics[key] !== undefined,
        )
      : [];
    sections.push(`<h2>${esc(t('ml.lab.batch.title'))} — ${esc(batch.fileName)}</h2>
    <p class="meta">${esc(
      t('ml.lab.batch.verdict', {
        name: batch.fileName,
        rows: batch.rowCount.toLocaleString(lang),
        model: t(`ml.lab.models.${batch.model}`),
      }),
    )}</p>
    ${
      rows.length > 0
        ? `<table><tr><th>${esc(t('ml.lab.batch.colMetric'))}</th><th>${esc(
            t('ml.lab.batch.colTest'),
          )}</th><th>${esc(t('ml.lab.batch.colBatch'))}</th><th>${esc(t('ml.lab.batch.colDelta'))}</th></tr>
    ${rows
      .map(({ key }) => {
        const delta = metricDelta(key, batch.testMetrics[key]!, batch.metrics![key]!);
        return `<tr><td>${esc(t(`ml.lab.leaderboard.${key}`))}</td><td>${fmt(batch.testMetrics[key])}</td><td>${fmt(
          batch.metrics![key],
        )}</td><td>${delta.value >= 0 ? '+' : ''}${delta.value.toFixed(3)}</td></tr>`;
      })
      .join('\n')}</table>`
        : `<p class="meta">${esc(t('ml.lab.batch.noTarget'))}</p>`
    }`);
  }

  if (artifacts.forecast) {
    const forecast = artifacts.forecast;
    sections.push(`<h2>${esc(t('ml.lab.forecast.title'))} — ${esc(forecast.valueColumn)}</h2>
    <p class="meta">${esc(
      t('ml.lab.forecast.summary', {
        points: forecast.totalPoints.toLocaleString(lang),
        freq: t(`ml.lab.forecast.freq.${forecast.freq}`),
        holdout: forecast.holdout,
        winner: t(`ml.lab.forecast.methods.${forecast.winner.key}`),
        mae: fmt(forecast.winner.mae),
        naive: fmt(forecast.naiveMae),
      }),
    )}</p>
    <table><tr><th>${esc(t('ml.lab.forecast.methodHeader'))}</th><th>MAE</th><th>RMSE</th></tr>
    ${forecast.methods
      .map(
        (method) =>
          `<tr${method.key === forecast.winner.key ? ' class="best"' : ''}><td>${esc(
            t(`ml.lab.forecast.methods.${method.key}`),
          )}</td><td>${fmt(method.mae)}</td><td>${fmt(method.rmse)}</td></tr>`,
      )
      .join('\n')}</table>`);
  }

  return sections.join('\n');
}

/**
 * Fully self-contained HTML report (inline CSS, no scripts, print-friendly) —
 * generated locally, downloadable, and convertible to PDF via the browser.
 */
export function buildReportHtml(record: RunRecord, t: Translate, lang: string): string {
  const isClassification = record.taskType !== 'regression';
  const ok = record.results.filter((r) => r.ok);
  const sorted = [...ok].sort((a, b) =>
    isClassification ? b.primary - a.primary : a.primary - b.primary,
  );
  const metricKeys = isClassification
    ? (['accuracy', 'f1', 'auc', 'logLoss'] as const)
    : (['rmse', 'mae', 'r2'] as const);

  const leaderboardRows = sorted
    .map(
      (r, i) => `<tr${i === 0 ? ' class="best"' : ''}>
        <td>${i + 1}</td><td>${esc(t(`ml.lab.models.${r.key}`))}</td>
        ${metricKeys.map((k) => `<td>${fmt(r.metrics[k])}</td>`).join('')}
        <td>${r.trainMs.toFixed(1)} ms</td></tr>`,
    )
    .join('\n');

  const confusion =
    record.insights.confusion && record.insights.classes
      ? `<h2>${esc(t('ml.lab.insights.confusionTitle'))} — ${esc(t(`ml.lab.models.${record.insights.model}`))}</h2>
      <table><tr><th></th>${record.insights.classes.map((c) => `<th>${esc(t('ml.lab.insights.predicted'))} ${esc(c)}</th>`).join('')}</tr>
      ${record.insights.confusion
        .map(
          (row, i) =>
            `<tr><th>${esc(t('ml.lab.insights.actual'))} ${esc(record.insights.classes![i])}</th>${row
              .map((v) => `<td>${v}</td>`)
              .join('')}</tr>`,
        )
        .join('\n')}</table>`
      : '';

  const importance = `<h2>${esc(t('ml.lab.insights.importanceTitle'))}</h2>
    <table><tr><th>${esc(t('ml.lab.leaderboard.model'))}</th><th>Δ</th></tr>
    ${record.insights.importance
      .slice(0, 8)
      .map(
        (e) =>
          `<tr><td>${esc(e.column)}</td><td>${e.value >= 0 ? '+' : ''}${e.value.toFixed(3)}</td></tr>`,
      )
      .join('\n')}</table>`;

  const read = buildPlainRead(record, t, lang);

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<title>LabML — ${esc(record.name)}</title>
<style>
  body { font-family: system-ui, sans-serif; color: #17221f; margin: 2rem auto; max-width: 52rem; padding: 0 1rem; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
  .meta { color: #5a6a65; font-size: .9rem; font-family: ui-monospace, monospace; }
  .read { background: #ebf1ef; border-radius: 12px; padding: 1rem 1.25rem; margin-top: 1.5rem; }
  table { border-collapse: collapse; margin-top: .75rem; font-size: .9rem; }
  th, td { border: 1px solid #d6e0dc; padding: .4rem .7rem; text-align: left; font-variant-numeric: tabular-nums; }
  th { background: #ebf1ef; font-weight: 600; }
  tr.best td { background: #dcebe6; font-weight: 600; }
  footer { margin-top: 3rem; color: #5a6a65; font-size: .8rem; border-top: 1px solid #d6e0dc; padding-top: 1rem; }
  @media print { body { margin: 0 auto; } }
</style>
</head>
<body>
<h1>LabML — ${esc(record.name)}</h1>
<p class="meta">${esc(record.dataset.name)} · ${record.dataset.rowCount.toLocaleString(lang)} × ${record.dataset.columnCount}
 · ${esc(t('ml.lab.targetLabel'))}: ${esc(record.target)}
 · ${esc(t(`ml.lab.task.${record.taskType}`, { count: record.insights.classes?.length ?? 0 }))}
 · seed ${record.seed} · ${new Date(record.createdAt).toLocaleString(lang)}</p>
${read ? `<div class="read">${esc(read)}</div>` : ''}
<h2>Leaderboard</h2>
<table>
<tr><th>#</th><th>${esc(t('ml.lab.leaderboard.model'))}</th>${metricKeys
    .map((k) => `<th>${esc(t(`ml.lab.leaderboard.${k}`))}</th>`)
    .join('')}<th>${esc(t('ml.lab.leaderboard.trainTime'))}</th></tr>
${leaderboardRows}
</table>
${confusion}
${importance}
${artifactSections(record, t, lang)}
<footer>${esc(t('ml.lab.reportFooter'))} — https://app.dominicdapice.com/ml</footer>
</body>
</html>`;
}

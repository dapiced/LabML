/**
 * V58: the model card — the page someone ELSE reads before using or approving
 * a model. The HTML report is a technical account for whoever trained it; the
 * card answers a different reader: what is this model for, what was it built
 * on, what is it worth, where does it fail, and what was never checked.
 *
 * A card can lie in two ways, and the two rules below are the whole design:
 *
 *  1. NOTHING IS INVENTED. The intended use is typed by the user. When it is
 *     not, the card says « not stated » in so many words; it does not guess a
 *     purpose from a file name.
 *  2. WHAT WAS NOT ASSESSED IS LISTED. An analysis nobody ran (the robust
 *     ranking, the segments, the prediction sets…) appears under « Not
 *     assessed » instead of quietly disappearing. A card with no weakness
 *     section reads as a model with no weakness.
 *
 * One more thing the run forces on the card: the analyses attached to a run
 * describe the model that was INSPECTED when they were computed, which is not
 * always the champion. Each such section names its model, and says so when it
 * is not the one this card is about.
 *
 * `buildModelCard` returns a structure, never text. The two renderings below
 * are written from that one structure, so the Markdown and the HTML cannot
 * state different facts. Every line is plain text: the renderers escape all
 * of it, the user's words and the column names alike. A share link is input
 * from a stranger.
 */
import type { RunRecord } from '@/features/ml/projects/types';
import { conformalLines } from '@/features/ml/train/conformal-analysis';
import { noteText } from '@/features/ml/train/journal';
import { bestResult, championGap } from '@/features/ml/train/ranking';
import type { MetricMap, ModelKey } from '@/features/ml/train/types';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** What the user types. Everything else on the card comes from the run. */
export interface CardFields {
  intendedUse?: string;
  outOfScope?: string;
  owner?: string;
}

export const CARD_FIELDS = ['intendedUse', 'outOfScope', 'owner'] as const;
export type CardField = (typeof CARD_FIELDS)[number];

/** A typed field is a sentence or two, not a document. */
export const MAX_FIELD_LENGTH = 600;
/** Below this many test rows the card says the measure is soft. */
export const SMALL_TEST_ROWS = 200;
const MAX_LISTED_COLUMNS = 20;
const MAX_FAILURE_COLUMNS = 3;

export interface CardLine {
  /** Shown before the text, emphasised. */
  label?: string;
  text: string;
}

export interface CardTable {
  head: string[];
  rows: string[][];
}

export interface CardSection {
  id: string;
  title: string;
  lines: CardLine[];
  table?: CardTable;
}

export interface ModelCard {
  title: string;
  subtitle: string;
  /** False while the intended use is not stated: the card says so on top. */
  complete: boolean;
  /** The sentence shown when `complete` is false. */
  incompleteNotice: string;
  sections: CardSection[];
  footer: string;
}

/**
 * One line of text from whatever was typed or decoded: no line breaks, no
 * runs of spaces, bounded. Not a string means nothing was stated.
 */
export function cleanField(value: unknown): string {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_FIELD_LENGTH ? `${flat.slice(0, MAX_FIELD_LENGTH - 1)}…` : flat;
}

const METRIC_KEYS = {
  classification: ['accuracy', 'f1', 'precision', 'recall', 'auc', 'logLoss'],
  regression: ['rmse', 'mae', 'r2'],
} as const satisfies Record<string, readonly (keyof MetricMap)[]>;

export function buildModelCard(
  record: RunRecord,
  t: Translate,
  lang: string,
  appVersion: string,
): ModelCard {
  const num = (value: number, digits = 3) =>
    Number.isFinite(value)
      ? value.toLocaleString(lang, { maximumFractionDigits: digits, minimumFractionDigits: digits })
      : '—';
  const int = (value: number) => value.toLocaleString(lang);
  const pct = (share: number, digits = 1) =>
    (share * 100).toLocaleString(lang, { maximumFractionDigits: digits });
  const modelName = (key: ModelKey) => t(`ml.lab.models.${key}`);
  const line = (key: string, text: string): CardLine => ({ label: t(`ml.lab.card.${key}`), text });
  const say = (key: string, options?: Record<string, unknown>): CardLine => ({
    text: t(`ml.lab.card.${key}`, options),
  });

  const { summary, artifacts = {} } = record;
  const isClassification = record.taskType !== 'regression';
  const subject = bestResult(record.results, record.taskType);
  const subjectKey = subject?.key ?? record.insights.model;
  const metricLabel = t(`ml.lab.leaderboard.${isClassification ? 'accuracy' : 'rmse'}`);
  /** « — about k-NN, not the model of this card » when an analysis looked elsewhere. */
  const about = (model: ModelKey): CardLine =>
    model === subjectKey
      ? say('aboutSubject', { model: modelName(model) })
      : say('aboutOther', { model: modelName(model), subject: modelName(subjectKey) });

  const fields = (record.card ?? {}) as Record<string, unknown>;
  const stated = (field: CardField) => cleanField(fields[field]);
  const orNotStated = (text: string) => (text === '' ? t('ml.lab.card.notStated') : text);
  const complete = stated('intendedUse') !== '';

  const sections: CardSection[] = [];

  // 1. Identity
  sections.push({
    id: 'identity',
    title: t('ml.lab.card.identityTitle'),
    lines: [
      line('model', modelName(subjectKey)),
      line(
        'task',
        t(`ml.lab.task.${record.taskType}`, { count: record.insights.classes?.length ?? 0 }),
      ),
      line('target', record.target),
      line('created', new Date(record.createdAt).toLocaleString(lang)),
      line('seed', String(record.seed)),
      line('builtWith', `LabML ${appVersion}`),
    ],
  });

  // 2. Intended use — the user's words, or the plain statement that there are none.
  sections.push({
    id: 'intended',
    title: t('ml.lab.card.intendedTitle'),
    lines: [
      line('intendedUse', orNotStated(stated('intendedUse'))),
      line('outOfScope', orNotStated(stated('outOfScope'))),
      line('owner', orNotStated(stated('owner'))),
    ],
  });

  // 3. Data — what the run knows about it, and not one row of it.
  const listColumns = (columns: string[]) =>
    columns.length === 0
      ? t('ml.lab.card.none')
      : columns.length <= MAX_LISTED_COLUMNS
        ? columns.join(', ')
        : `${columns.slice(0, MAX_LISTED_COLUMNS).join(', ')} ${t('ml.lab.card.andMore', {
            count: columns.length - MAX_LISTED_COLUMNS,
          })}`;
  const data: CardLine[] = [
    line(
      'file',
      t('ml.lab.card.fileShape', {
        name: record.dataset.name,
        rows: int(record.dataset.rowCount),
        columns: record.dataset.columnCount,
      }),
    ),
    line('featuresUsed', listColumns(summary.featureColumns)),
    line('featuresSkipped', listColumns(summary.skippedColumns)),
    line(
      'splits',
      summary.validationRows !== undefined
        ? t('ml.lab.card.splitsThree', {
            train: int(summary.trainRows),
            validation: int(summary.validationRows),
            test: int(summary.testRows),
          })
        : t('ml.lab.card.splitsTwo', {
            train: int(summary.trainRows),
            test: int(summary.testRows),
          }),
    ),
    line(
      'splitMode',
      summary.split
        ? t(`ml.lab.card.split.${summary.split.mode}`, { column: summary.split.column })
        : t(`ml.lab.card.split.${isClassification ? 'stratified' : 'random'}`),
    ),
  ];
  if (summary.sampledFrom !== undefined) {
    data.push(say('sampled', { from: int(summary.sampledFrom) }));
  }
  if (summary.majorityShare !== undefined) {
    data.push(
      line(
        'balance',
        t(
          summary.classWeighting
            ? 'ml.lab.card.majorityWeighted'
            : 'ml.lab.card.majorityUnweighted',
          {
            share: pct(summary.majorityShare, 0),
          },
        ),
      ),
    );
  }
  for (const leak of summary.leakWarnings ?? []) {
    data.push(say('leak', { column: leak.column, score: pct(leak.score) }));
  }
  data.push(say('noRows'));
  sections.push({ id: 'data', title: t('ml.lab.card.dataTitle'), lines: data });

  // 4. Performance
  const performance: CardLine[] = [];
  let metricsTable: CardTable | undefined;
  if (subject) {
    const interval = artifacts.uncertainty?.intervals.find((entry) => entry.model === subjectKey);
    performance.push(
      line(
        'onTest',
        interval
          ? t('ml.lab.card.testWithInterval', {
              metric: metricLabel,
              value: num(subject.primary),
              lo: num(interval.lo),
              hi: num(interval.hi),
              rows: int(summary.testRows),
            })
          : t('ml.lab.card.testAlone', {
              metric: metricLabel,
              value: num(subject.primary),
              rows: int(summary.testRows),
            }),
      ),
    );
    const baseline = record.results.find((result) => result.ok && result.key === 'baseline');
    if (baseline && subjectKey !== 'baseline') {
      performance.push(
        line(
          'baseline',
          t('ml.lab.card.baselineGap', {
            metric: metricLabel,
            baseline: num(baseline.primary),
            delta: num(Math.abs(subject.primary - baseline.primary)),
          }),
        ),
      );
    }
    const verdict = artifacts.uncertainty?.verdict;
    if (verdict && verdict.winner === subjectKey) {
      performance.push(
        say(verdict.decisive ? 'gapReal' : 'gapNoise', { share: pct(verdict.winShare) }),
      );
    }
    const gap = championGap(record.results, record.taskType);
    performance.push(
      gap
        ? line(
            'selection',
            t('ml.lab.card.pickedThenScored', {
              metric: metricLabel,
              validation: num(gap.val),
              test: num(gap.test),
            }),
          )
        : say('pickedOnTest'),
    );
    const keys = METRIC_KEYS[isClassification ? 'classification' : 'regression'].filter(
      (key) => subject.metrics[key] !== undefined,
    );
    // Precision and recall have no leaderboard column: their names live with
    // the threshold panel.
    const metricName = (key: string) =>
      t(
        key === 'precision' || key === 'recall'
          ? `ml.lab.threshold.${key}`
          : `ml.lab.leaderboard.${key}`,
      );
    metricsTable = {
      head: keys.map(metricName),
      rows: [keys.map((key) => num(subject.metrics[key] ?? Number.NaN))],
    };
    const robust = artifacts.robustRank;
    const robustEntry = robust?.entries.find((entry) => entry.model === subjectKey);
    if (robust && robustEntry) {
      performance.push(
        line(
          'robust',
          t('ml.lab.card.robustMean', {
            mean: num(robustEntry.mean),
            sd: num(robustEntry.sd),
            folds: robustEntry.scores.length,
          }),
        ),
      );
    }
  }
  sections.push({
    id: 'performance',
    title: t('ml.lab.card.performanceTitle'),
    lines: performance,
    ...(metricsTable && { table: metricsTable }),
  });

  // 5. Uncertainty on one prediction (V57)
  if (artifacts.conformal) {
    sections.push({
      id: 'uncertainty',
      title: t('ml.lab.card.uncertaintyTitle'),
      lines: [
        about(artifacts.conformal.model),
        ...conformalLines(artifacts.conformal, t, lang).map((text) => ({ text })),
      ],
    });
  }

  // 6. Decision rule, when one was set
  const decision: CardLine[] = [];
  if (artifacts.threshold) {
    const chosen = artifacts.threshold.chosen;
    decision.push(
      about(artifacts.threshold.model),
      say('threshold', {
        positive: artifacts.threshold.positiveClass,
        threshold: num(chosen.threshold, 2),
        costFp: chosen.costFp,
        costFn: chosen.costFn,
      }),
      say('thresholdMetrics', {
        precision: num(chosen.precision),
        recall: num(chosen.recall),
        f1: num(chosen.f1),
      }),
    );
  }
  if (artifacts.multiclassDecision) {
    const policy = artifacts.multiclassDecision;
    decision.push(
      about(policy.model),
      say('multiclass', {
        thresholds: policy.classes
          .map((name, index) => `${name} ≥ ${num(policy.policy.thresholds[index] ?? 0, 2)}`)
          .join(', '),
      }),
      say(policy.exploratory ? 'multiclassExploratory' : 'multiclassFrozen', {
        coverage: pct(policy.test.coverage),
        accuracy: num(policy.test.decidedAccuracy),
      }),
    );
  }
  if (decision.length > 0) {
    sections.push({ id: 'decision', title: t('ml.lab.card.decisionTitle'), lines: decision });
  }

  // 7. Where it fails
  if (artifacts.segments) {
    const segments = artifacts.segments;
    const failures: CardLine[] = [
      about(segments.model),
      say('overall', {
        metric: t(`ml.lab.leaderboard.${segments.metricLabel}`),
        value: num(segments.overall),
      }),
    ];
    const worst = segments.columns
      .filter((column) => column.segments.length > 0)
      .slice(0, MAX_FAILURE_COLUMNS);
    for (const column of worst) {
      const slice = column.segments[0];
      failures.push(
        say('worstSlice', {
          column: column.column,
          value: slice.value,
          metric: num(slice.metric),
          rows: int(slice.rows),
        }),
      );
    }
    if (worst.length === 0) failures.push(say('noSlice'));
    sections.push({ id: 'failures', title: t('ml.lab.card.failuresTitle'), lines: failures });
  }

  // 8. Run journal (V55)
  const notes = [
    ...(Array.isArray(summary.notes) ? summary.notes : []),
    ...(Array.isArray(artifacts.robustRank?.notes) ? artifacts.robustRank.notes : []),
  ];
  sections.push({
    id: 'journal',
    title: t('ml.lab.card.journalTitle'),
    lines:
      notes.length > 0 ? notes.map((note) => ({ text: noteText(note, t) })) : [say('journalEmpty')],
  });

  // 9. Not assessed — every analysis this run does not carry, by name.
  const missing: string[] = [];
  if (!artifacts.uncertainty) missing.push('uncertainty');
  if (!artifacts.robustRank) missing.push('robust');
  if (!artifacts.conformal) missing.push('conformal');
  if (!artifacts.segments) missing.push('segments');
  if (isClassification && !artifacts.threshold && !artifacts.multiclassDecision) {
    missing.push('decision');
  }
  if (!artifacts.learningCurve) missing.push('learningCurve');
  if (!artifacts.tuning) missing.push('tuning');
  // Always true today: LabML has no audit by protected group, and a card that
  // stayed silent about it would read as « checked, nothing found ».
  missing.push('fairness');
  sections.push({
    id: 'notAssessed',
    title: t('ml.lab.card.notAssessedTitle'),
    lines: missing.map((key) => say(`notAssessed.${key}`)),
  });

  // 10. Limits — each one a fact of this run, not boilerplate.
  const limits: CardLine[] = [];
  if (summary.testRows < SMALL_TEST_ROWS) {
    limits.push(say('limitSmallTest', { rows: int(summary.testRows) }));
  }
  if (summary.imbalanced) {
    limits.push(say('limitImbalanced', { share: pct(summary.majorityShare ?? 0, 0) }));
  }
  if (summary.validationRows === undefined) limits.push(say('limitNoValidation'));
  if ((summary.leakWarnings ?? []).length > 0) limits.push(say('limitLeak'));
  if (subjectKey === 'knn') limits.push(say('limitNotExportable'));
  if (!complete) limits.push(say('limitNoIntendedUse'));
  limits.push(say('limitOneSplit', { seed: record.seed }), say('limitDrift'));
  sections.push({ id: 'limits', title: t('ml.lab.card.limitsTitle'), lines: limits });

  // 11. Reproduce
  sections.push({
    id: 'reproduce',
    title: t('ml.lab.card.reproduceTitle'),
    lines: [
      say('reproduce', {
        name: record.dataset.name,
        target: record.target,
        features: summary.featureColumns.length,
        seed: record.seed,
      }),
      { text: 'https://app.dominicdapice.com/ml' },
    ],
  });

  return {
    title: t('ml.lab.card.title', { name: record.name }),
    subtitle: t('ml.lab.card.subtitle', {
      model: modelName(subjectKey),
      date: new Date(record.createdAt).toLocaleDateString(lang),
    }),
    complete,
    incompleteNotice: t('ml.lab.card.incomplete'),
    sections,
    footer: t('ml.lab.reportFooter'),
  };
}

/**
 * The characters Markdown reads as syntax wherever they stand, escaped. The
 * card's lines are plain text by contract, so a column called `a|b` or a typed
 * `[link](x)` stays text: with the brackets escaped, the parentheses after
 * them mean nothing. Hyphens, dots and parentheses are left alone, since every
 * line is written behind a `- ` or a `| ` and none can open a block.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]#|<>~])/g, '\\$1');
}

export function modelCardMarkdown(card: ModelCard): string {
  const out: string[] = [`# ${escapeMarkdown(card.title)}`, '', escapeMarkdown(card.subtitle), ''];
  if (!card.complete) out.push(`> ${escapeMarkdown(card.incompleteNotice)}`, '');
  for (const section of card.sections) {
    out.push(`## ${escapeMarkdown(section.title)}`, '');
    for (const { label, text } of section.lines) {
      out.push(
        label
          ? `- **${escapeMarkdown(label)}** ${escapeMarkdown(text)}`
          : `- ${escapeMarkdown(text)}`,
      );
    }
    if (section.table) {
      out.push(
        '',
        `| ${section.table.head.map(escapeMarkdown).join(' | ')} |`,
        `| ${section.table.head.map(() => '---').join(' | ')} |`,
        ...section.table.rows.map((row) => `| ${row.map(escapeMarkdown).join(' | ')} |`),
      );
    }
    out.push('');
  }
  out.push('---', '', escapeMarkdown(card.footer), '');
  return out.join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Self-contained and printable, in the style of the run report: no script, no request. */
export function modelCardHtml(card: ModelCard, lang: string): string {
  const sections = card.sections
    .map((section) => {
      const lines = section.lines
        .map(({ label, text }) =>
          label
            ? `<li><strong>${escapeHtml(label)}</strong> ${escapeHtml(text)}</li>`
            : `<li>${escapeHtml(text)}</li>`,
        )
        .join('\n');
      const table = section.table
        ? `<table><tr>${section.table.head.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr>
${section.table.rows
  .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
  .join('\n')}</table>`
        : '';
      return `<section id="${escapeHtml(section.id)}">
<h2>${escapeHtml(section.title)}</h2>
<ul>
${lines}
</ul>
${table}
</section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(card.title)}</title>
<style>
  body { font-family: system-ui, sans-serif; color: #17221f; margin: 2rem auto; max-width: 48rem; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.6rem; margin-bottom: .2rem; } h2 { font-size: 1.1rem; margin-top: 2rem; border-bottom: 1px solid #d6e0dc; padding-bottom: .3rem; }
  .meta { color: #5a6a65; font-size: .9rem; font-family: ui-monospace, monospace; }
  .warn { background: #f3e6da; color: #8f4c1f; padding: .6rem .8rem; border-radius: 8px; font-size: .9rem; }
  ul { padding-left: 1.2rem; } li { margin: .3rem 0; }
  table { border-collapse: collapse; margin-top: .75rem; font-size: .9rem; }
  th, td { border: 1px solid #d6e0dc; padding: .4rem .7rem; text-align: left; font-variant-numeric: tabular-nums; }
  th { background: #ebf1ef; font-weight: 600; }
  footer { margin-top: 3rem; color: #5a6a65; font-size: .8rem; border-top: 1px solid #d6e0dc; padding-top: 1rem; }
  @media print { body { margin: 0 auto; } }
</style>
</head>
<body>
<h1>${escapeHtml(card.title)}</h1>
<p class="meta">${escapeHtml(card.subtitle)}</p>
${card.complete ? '' : `<p class="warn">${escapeHtml(card.incompleteNotice)}</p>`}
${sections}
<footer>${escapeHtml(card.footer)}</footer>
</body>
</html>`;
}

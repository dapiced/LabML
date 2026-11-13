import { useTranslation } from 'react-i18next';
import type {
  GlassBoxPayload,
  Replay,
  SplitStep,
  StagedValidation,
} from '@/features/ml/train/glass-box';
import type { ModelKey } from '@/features/ml/train/types';

/** The families a replay has steps to tell for. */
const REPLAYABLE: ModelKey[] = ['tree', 'forest', 'knn', 'gbdt'];

export function isReplayable(model: ModelKey): boolean {
  return REPLAYABLE.includes(model);
}

/** A curve as a small line: the shape matters here, the figures are in the text. */
function Sparkline({ values, mark, label }: { values: number[]; mark?: number; label: string }) {
  if (values.length < 2) return null;
  const width = 240;
  const height = 48;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (value: number) => height - 4 - ((value - min) / span) * (height - 8);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      className="h-12 w-full max-w-60 text-accent"
    >
      <polyline
        points={values.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {mark !== undefined && (
        <circle cx={x(mark)} cy={y(values[mark])} r="3" className="fill-copper" />
      )}
    </svg>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

function stepText(step: SplitStep, t: Translate, num: (value: number) => string): string {
  const answer = t(step.passed ? 'ml.lab.glass.yes' : 'ml.lab.glass.no');
  if (step.kind === 'category') {
    return t('ml.lab.glass.step.category', {
      column: step.column,
      category: step.category,
      answer,
    });
  }
  return t(`ml.lab.glass.step.${step.kind}`, {
    column: step.column,
    feature: step.feature,
    operator: step.operator === '<' ? '<' : '≤',
    threshold: num(step.threshold ?? 0),
    value: num(step.value ?? 0),
    answer,
  });
}

function Steps({
  steps,
  t,
  num,
}: {
  steps: SplitStep[];
  t: Translate;
  num: (v: number) => string;
}) {
  const lang = useTranslation().i18n.resolvedLanguage ?? 'en';
  return (
    <ol className="flex list-decimal flex-col gap-1 pl-5">
      {steps.map((step, i) => (
        <li key={i}>
          {stepText(step, t, num)}
          {step.rows !== undefined && (
            <span className="text-muted">
              {' '}
              {t('ml.lab.glass.step.rows', {
                count: step.rows,
                rows: step.rows.toLocaleString(lang),
              })}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function validationKey(validation: StagedValidation): 'never' | 'early' | 'late' {
  const last = validation.curve.length - 1;
  if (validation.bestRound === 0) return 'never';
  // Two percent: below that the last rounds cost nothing worth a sentence.
  return validation.curve[last] > validation.curve[validation.bestRound] * 1.02 ? 'early' : 'late';
}

/**
 * V66: one row replayed through the inspected model. The last step shown is
 * the model's own prediction, by construction and by test.
 */
export function GlassBoxView({ payload }: { payload: GlassBoxPayload }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const num = (value: number, digits = 3) =>
    value.toLocaleString(lang, { maximumFractionDigits: digits });
  const count = (value: number) => value.toLocaleString(lang);
  const { classes, isClassification } = payload;
  const answer = (prediction: number) =>
    isClassification ? (classes[prediction] ?? String(prediction)) : num(prediction);
  const replay: Replay = payload.replay;
  if (replay.kind === 'none') return null;

  return (
    <div
      className="flex flex-col gap-3 border-t border-line pt-3 text-xs [&_p]:max-w-3xl"
      data-testid="glass-box"
      data-kind={replay.kind}
    >
      <p className="font-medium">{t(`ml.lab.glass.title.${replay.kind}`)}</p>

      {replay.kind === 'tree' && (
        <>
          {replay.steps.length === 0 ? (
            <p>{t('ml.lab.glass.tree.noQuestion')}</p>
          ) : (
            <Steps steps={replay.steps} t={t} num={(value) => num(value)} />
          )}
          <p data-testid="glass-answer">
            {replay.leaf
              ? isClassification
                ? t('ml.lab.glass.tree.leafClasses', {
                    count: replay.leaf.rows,
                    rows: count(replay.leaf.rows),
                    detail: (replay.leaf.counts ?? [])
                      .map((value, c) => ({ label: classes[c] ?? String(c), value }))
                      .filter((item) => item.value > 0)
                      .map((item) => `${item.label}: ${count(item.value)}`)
                      .join(' · '),
                    answer: answer(replay.prediction),
                  })
                : t('ml.lab.glass.tree.leafValue', {
                    count: replay.leaf.rows,
                    rows: count(replay.leaf.rows),
                    answer: answer(replay.prediction),
                  })
              : t('ml.lab.glass.tree.leafBare', { answer: answer(replay.prediction) })}
          </p>
        </>
      )}

      {replay.kind === 'forest' && (
        <>
          <p data-testid="glass-answer">
            {replay.votes
              ? t('ml.lab.glass.forest.votes', {
                  trees: replay.trees,
                  detail: replay.votes
                    .map((value, c) => ({ label: classes[c] ?? String(c), value }))
                    .filter((item) => item.value > 0)
                    .sort((a, b) => b.value - a.value)
                    .map((item) => `${item.label}: ${item.value}`)
                    .join(' · '),
                  answer: answer(replay.prediction),
                })
              : t('ml.lab.glass.forest.spread', {
                  trees: replay.trees,
                  min: num(replay.spread?.min ?? 0),
                  max: num(replay.spread?.max ?? 0),
                  answer: answer(replay.prediction),
                })}
          </p>
          {replay.tiedVote && <p className="text-copper">{t('ml.lab.glass.forest.tie')}</p>}
          <p className="text-muted">{t('ml.lab.glass.forest.note')}</p>
        </>
      )}

      {replay.kind === 'knn' && (
        <>
          <div className="max-w-full overflow-x-auto">
            <table className="text-left" data-testid="glass-neighbours">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-1 pr-3 font-normal">{t('ml.lab.glass.knn.row')}</th>
                  <th className="py-1 pr-3 font-normal">{t('ml.lab.glass.knn.distance')}</th>
                  <th className="py-1 pr-3 font-normal">{t('ml.lab.glass.knn.target')}</th>
                  {replay.columns.map((name) => (
                    <th key={name} className="py-1 pr-3 font-mono font-normal">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {replay.rows.map((row, i) => (
                  <tr key={i} className="border-b border-line last:border-b-0">
                    <td className="py-1 pr-3 font-mono tabular-nums">
                      {row.row === null ? '?' : count(row.row)}
                    </td>
                    <td className="py-1 pr-3 font-mono tabular-nums">
                      {num(replay.neighbours[i].distance)}
                    </td>
                    <td className="py-1 pr-3 font-mono">{row.target}</td>
                    {row.cells.map((cell, c) => (
                      <td key={c} className="max-w-40 truncate py-1 pr-3 font-mono">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p data-testid="glass-answer">
            {replay.votes
              ? t('ml.lab.glass.knn.votes', {
                  k: replay.neighbours.length,
                  detail: replay.votes
                    .map((value, c) => ({ label: classes[c] ?? String(c), value }))
                    .filter((item) => item.value > 0)
                    .sort((a, b) => b.value - a.value)
                    .map((item) => `${item.label}: ${item.value}`)
                    .join(' · '),
                  answer: answer(replay.prediction),
                })
              : t('ml.lab.glass.knn.mean', {
                  k: replay.neighbours.length,
                  answer: answer(replay.prediction),
                })}
          </p>
          {replay.tieAtTheEdge && (
            <p className="text-copper" data-testid="glass-edge-tie">
              {t('ml.lab.glass.knn.edgeTie')}
            </p>
          )}
          {replay.tiedVote && <p className="text-copper">{t('ml.lab.glass.knn.voteTie')}</p>}
          <p className="text-muted">{t('ml.lab.glass.knn.note')}</p>
        </>
      )}

      {replay.kind === 'gbdt' && (
        <>
          <p data-testid="glass-answer">
            {t(isClassification ? 'ml.lab.glass.gbdt.curveClass' : 'ml.lab.glass.gbdt.curveValue', {
              class: answer(replay.prediction),
              from: num(replay.curve[0]),
              to: num(replay.curve[replay.rounds]),
              rounds: replay.rounds,
              settled: replay.settledAt,
            })}
          </p>
          <Sparkline values={replay.curve} label={t('ml.lab.glass.gbdt.curveLabel')} />
          {replay.told.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-muted">{t('ml.lab.glass.gbdt.toldTitle')}</p>
              {replay.told.map((item) => (
                <div key={item.round}>
                  <p>
                    {t('ml.lab.glass.gbdt.round', {
                      round: item.round,
                      from: num(item.from),
                      to: num(item.to),
                    })}{' '}
                    {item.sameQuestions > 0 && (
                      <span className="text-muted">
                        {t('ml.lab.glass.gbdt.same', { count: item.sameQuestions })}
                      </span>
                    )}
                  </p>
                  <Steps steps={item.steps} t={t} num={(value) => num(value)} />
                </div>
              ))}
            </div>
          )}
          {replay.validation && (
            <div className="flex flex-col gap-1" data-testid="glass-validation">
              <p>
                {t(`ml.lab.glass.gbdt.validation.${validationKey(replay.validation)}`, {
                  metric: t(`ml.lab.glass.gbdt.metric.${replay.validation.metric}`),
                  rows: count(replay.validation.rows),
                  best: replay.validation.bestRound,
                  bestValue: num(replay.validation.curve[replay.validation.bestRound]),
                  last: replay.validation.curve.length - 1,
                  lastValue: num(replay.validation.curve[replay.validation.curve.length - 1]),
                  start: num(replay.validation.curve[0]),
                })}
              </p>
              <Sparkline
                values={replay.validation.curve}
                mark={replay.validation.bestRound}
                label={t('ml.lab.glass.gbdt.validationLabel')}
              />
              <p className="text-muted">{t('ml.lab.glass.gbdt.validationNote')}</p>
            </div>
          )}
        </>
      )}

      <p className="text-[0.68rem] text-muted">{t('ml.lab.glass.note')}</p>
    </div>
  );
}

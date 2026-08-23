import { useTranslation } from 'react-i18next';
import { Eyebrow } from '@/components/ui/eyebrow';

/**
 * Signed word effects (V24): a diverging bar per word, drawn from a centre
 * line so the direction is the first thing you read — words pushing the
 * answer up go right in teal, words pushing it down go left in copper.
 *
 * V35: when the method cannot measure — a model whose probabilities are
 * saturated shifts by exactly zero for every word — the card still appears
 * and says why. Vanishing would read as "no word matters", which is false.
 */
export function WordEffects({
  words,
  isClassification,
  positiveClass,
  refusal,
}: {
  words: { column: string; term: string; effect: number; rows: number }[];
  isClassification: boolean;
  positiveClass?: string;
  refusal?: 'saturated';
}) {
  const { t } = useTranslation();
  const peak = Math.max(...words.map((word) => Math.abs(word.effect)), 1e-9);

  if (refusal !== undefined) {
    return (
      <div
        data-testid="word-effects"
        className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4"
      >
        <Eyebrow>{t('ml.lab.insights.wordsTitle')}</Eyebrow>
        <p className="text-sm">{t('ml.lab.insights.wordsSaturated')}</p>
        <p className="text-xs text-muted">{t('ml.lab.insights.wordsSaturatedAdvice')}</p>
      </div>
    );
  }

  return (
    <div
      data-testid="word-effects"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4"
    >
      <Eyebrow>{t('ml.lab.insights.wordsTitle')}</Eyebrow>
      <div className="flex flex-col gap-1.5">
        {words.map(({ column, term, effect, rows }) => (
          <div
            key={`${column}:${term}`}
            className="flex items-center gap-2"
            title={t('ml.lab.insights.wordsRowTitle', {
              column,
              term,
              rows,
              effect: effect.toFixed(4),
            })}
          >
            <span className="w-24 shrink-0 truncate font-mono text-xs">{term}</span>
            {/* Two halves of one axis: the centre is "this word changes nothing". */}
            <div className="flex h-2.5 flex-1 items-stretch">
              <div className="flex flex-1 justify-end bg-surface-2">
                {effect < 0 && (
                  <div
                    className="rounded-l-[2px] bg-copper/80"
                    style={{ width: `${(Math.abs(effect) / peak) * 100}%` }}
                  />
                )}
              </div>
              <div className="w-px bg-line" aria-hidden="true" />
              <div className="flex flex-1 bg-surface-2">
                {effect > 0 && (
                  <div
                    className="rounded-r-[2px] bg-accent/75"
                    style={{ width: `${(effect / peak) * 100}%` }}
                  />
                )}
              </div>
            </div>
            <span className="w-14 shrink-0 text-right font-mono text-xs text-muted tabular-nums">
              {effect >= 0 ? '+' : '−'}
              {Math.abs(effect).toFixed(3)}
            </span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">
        {isClassification
          ? t('ml.lab.insights.wordsHintClassification', { class: positiveClass ?? '' })
          : t('ml.lab.insights.wordsHintRegression')}
      </p>
      <p className="text-xs text-muted">{t('ml.lab.insights.wordsNote')}</p>
    </div>
  );
}

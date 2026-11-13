import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { Change, CounterfactualPayload } from '@/features/ml/train/counterfactual';

/**
 * V68: what would have to change for the model to answer another class. Each
 * change comes with its two readings: does the changed row still look like a
 * training row, and do the other models follow.
 */
export function CounterfactualView({
  payload,
  onApply,
}: {
  payload: CounterfactualPayload;
  onApply: (changes: Change[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const name = (index: number) => payload.classes[index] ?? String(index);
  const percent = (value: number) =>
    (value * 100).toLocaleString(lang, { maximumFractionDigits: 1 });
  const { tried } = payload;

  return (
    <div
      className="flex flex-col gap-3 border-t border-line pt-3 text-xs [&_p]:max-w-3xl"
      data-testid="counterfactual"
      data-found={payload.found.length}
    >
      <p className="font-medium">
        {payload.target === null
          ? t('ml.lab.counterfactual.titleAny', { current: name(payload.current) })
          : t('ml.lab.counterfactual.titleTarget', {
              current: name(payload.current),
              target: name(payload.target),
            })}
      </p>

      {payload.found.length === 0 ? (
        <p data-testid="counterfactual-none">
          {tried.columns.length === 0
            ? t('ml.lab.counterfactual.allLocked')
            : t('ml.lab.counterfactual.none', {
                count: tried.columns.length,
                rows: tried.rows.toLocaleString(lang),
              })}
        </p>
      ) : (
        <>
          <p data-testid="counterfactual-size">
            {t(
              payload.columnsChanged === 1
                ? 'ml.lab.counterfactual.oneColumn'
                : 'ml.lab.counterfactual.twoColumns',
            )}
          </p>
          <ul className="flex flex-col gap-3">
            {payload.found.map((item, i) => (
              <li key={i} className="flex flex-col gap-1" data-testid="counterfactual-item">
                <span className="font-mono">
                  {item.changes
                    .map((change) => `${change.column}: ${change.from || '∅'} → ${change.to}`)
                    .join('  ·  ')}
                </span>
                <span>
                  {item.probability === undefined
                    ? t('ml.lab.counterfactual.answers', { class: name(item.prediction) })
                    : t('ml.lab.counterfactual.answersProba', {
                        class: name(item.prediction),
                        percent: percent(item.probability),
                      })}{' '}
                  {item.followed.of > 0 && (
                    <span
                      className={item.followed.by * 2 < item.followed.of ? 'text-copper' : ''}
                      data-testid="counterfactual-followed"
                    >
                      {t('ml.lab.counterfactual.followed', {
                        by: item.followed.by,
                        count: item.followed.of,
                      })}
                    </span>
                  )}
                </span>
                {item.far && (
                  <span className="text-copper" data-testid="counterfactual-far">
                    {t('ml.lab.counterfactual.far')}
                  </span>
                )}
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="counterfactual-apply"
                    onClick={() => onApply(item.changes)}
                  >
                    {t('ml.lab.counterfactual.apply')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {(tried.locked.length > 0 || payload.untouched.length > 0) && (
        <p className="text-muted" data-testid="counterfactual-kept">
          {[
            tried.locked.length > 0 &&
              t('ml.lab.counterfactual.locked', { list: tried.locked.join(', ') }),
            payload.untouched.length > 0 &&
              t('ml.lab.counterfactual.untouched', { list: payload.untouched.join(', ') }),
          ]
            .filter(Boolean)
            .join(' ')}
        </p>
      )}
      <p className="text-[0.68rem] text-muted">{t('ml.lab.counterfactual.note')}</p>
    </div>
  );
}

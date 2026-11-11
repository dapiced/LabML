import { Target } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useLabStore } from '@/features/ml/lab-store';
import { CONFORMAL_ALPHAS } from '@/features/ml/train/conformal';
import { conformalLines, isConformalRefusal } from '@/features/ml/train/conformal-analysis';

/**
 * V57: conformal prediction for the inspected model. A point prediction says
 * « cat »; this says « cat or lynx », or « 42 ± 6 », sized so that the truth
 * falls inside at the rate asked for — and shows the rate actually measured
 * on the test split beside that target, instead of asking to be believed.
 */
export function ConformalPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';
  const outcome = useLabStore((s) => s.conformalAnalysis);
  const alpha = useLabStore((s) => s.conformalAlpha);
  const setLevel = useLabStore((s) => s.setConformalLevel);
  if (!outcome) return null;

  const refused = isConformalRefusal(outcome);
  const lines = conformalLines(outcome, t, lang);
  // Whether the target sits inside what the test split can tell apart.
  const onTarget =
    !refused && outcome.coverageLo <= 1 - outcome.alpha && 1 - outcome.alpha <= outcome.coverageHi;

  return (
    <section
      data-testid="conformal-panel"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4"
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Target className="h-4 w-4 text-accent" aria-hidden="true" />
          <Eyebrow>{t('ml.lab.conformal.title')}</Eyebrow>
          <Badge variant="outline">{t(`ml.lab.models.${outcome.model}`)}</Badge>
          {!refused && (
            <Badge variant="outline" className="font-mono" data-testid="conformal-coverage">
              {(outcome.coverage * 100).toLocaleString(lang, { maximumFractionDigits: 1 })} %
            </Badge>
          )}
        </div>
        <p className="mt-1 max-w-3xl text-xs text-muted">{t('ml.lab.conformal.hint')}</p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        {t('ml.lab.conformal.level')}
        <select
          data-testid="conformal-level"
          className="rounded-lg border border-line bg-surface px-2 py-1 text-sm"
          value={alpha}
          onChange={(event) => setLevel(Number(event.target.value))}
        >
          {CONFORMAL_ALPHAS.map((option) => (
            <option key={option} value={option}>
              {((1 - option) * 100).toFixed(0)} %
            </option>
          ))}
        </select>
      </label>

      <div className="flex max-w-3xl flex-col gap-1.5 text-sm" data-testid="conformal-summary">
        {lines.map((line, index) => (
          <p key={index} className={index === 0 ? 'font-medium' : 'text-muted'}>
            {line}
          </p>
        ))}
        {!refused && (
          <p className="text-muted" data-testid="conformal-verdict">
            {t(onTarget ? 'ml.lab.conformal.verdictOnTarget' : 'ml.lab.conformal.verdictOffTarget')}
          </p>
        )}
      </div>

      <p className="max-w-3xl text-xs text-muted">{t('ml.lab.conformal.note')}</p>
    </section>
  );
}

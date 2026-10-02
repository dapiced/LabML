import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useLabStore } from '@/features/ml/lab-store';
import { evaluateMulticlassPolicy } from '@/features/ml/train/multiclass-decision';

export function MulticlassDecisionPanel() {
  const { t, i18n } = useTranslation();
  const decision = useLabStore((state) => state.multiclassDecision);
  const setThreshold = useLabStore((state) => state.setMulticlassThreshold);
  const testPolicy = useLabStore((state) => state.testMulticlassDecision);
  if (!decision) return null;

  const { analysis, editor } = decision;
  const validation = evaluateMulticlassPolicy(
    analysis.validationLabels,
    analysis.validationProbabilities,
    editor.policy,
  );
  const baseline = evaluateMulticlassPolicy(
    analysis.validationLabels,
    analysis.validationProbabilities,
    { thresholds: analysis.classes.map(() => 0) },
  );
  const pct = (value: number) =>
    (value * 100).toLocaleString(i18n.resolvedLanguage ?? 'en', { maximumFractionDigits: 1 });

  return (
    <section
      data-testid="multiclass-decision-panel"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-accent" aria-hidden="true" />
        <Eyebrow>{t('ml.lab.multiclassDecision.title')}</Eyebrow>
        <Badge variant="outline">{t(`ml.lab.multiclassDecision.phase.${editor.phase}`)}</Badge>
      </div>
      <p className="max-w-3xl text-xs text-muted">{t('ml.lab.multiclassDecision.hint')}</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {analysis.classes.map((label, classIndex) => (
          <label key={label} className="flex flex-col gap-1 text-sm">
            <span className="flex items-baseline justify-between gap-3">
              <span className="truncate">{label}</span>
              <span className="font-mono text-xs">
                {editor.policy.thresholds[classIndex].toFixed(2)}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={editor.policy.thresholds[classIndex]}
              onChange={(event) => setThreshold(classIndex, Number(event.target.value))}
              className="accent-(--accent)"
              aria-label={t('ml.lab.multiclassDecision.thresholdFor', { class: label })}
            />
          </label>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="outline">
          {t('ml.lab.multiclassDecision.coverage', { value: pct(validation.coverage) })}
        </Badge>
        <Badge variant="outline">
          {t('ml.lab.multiclassDecision.accuracy', { value: pct(validation.accuracy) })}
        </Badge>
        <Badge variant="outline">
          {t('ml.lab.multiclassDecision.decidedAccuracy', {
            value: pct(validation.decidedAccuracy),
          })}
        </Badge>
        <Badge variant="outline">P {pct(validation.macroPrecision)} %</Badge>
        <Badge variant="outline">R {pct(validation.macroRecall)} %</Badge>
        <Badge variant="outline">F1 {pct(validation.macroF1)} %</Badge>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="py-1 pr-3 font-normal">{t('ml.lab.multiclassDecision.class')}</th>
              <th className="py-1 pr-3 font-normal">P</th>
              <th className="py-1 pr-3 font-normal">R</th>
              <th className="py-1 font-normal">F1</th>
            </tr>
          </thead>
          <tbody>
            {validation.perClass.map((metrics) => (
              <tr key={metrics.classIndex} className="border-b border-line last:border-b-0">
                <td className="py-1 pr-3">{analysis.classes[metrics.classIndex]}</td>
                <td className="py-1 pr-3 font-mono">{pct(metrics.precision)} %</td>
                <td className="py-1 pr-3 font-mono">{pct(metrics.recall)} %</td>
                <td className="py-1 font-mono">{pct(metrics.f1)} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        {t('ml.lab.multiclassDecision.baseline', {
          accuracy: pct(baseline.accuracy),
          macroF1: pct(baseline.macroF1),
        })}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" onClick={testPolicy}>
          {t('ml.lab.multiclassDecision.test')}
        </Button>
        {editor.test && (
          <p className="text-xs text-muted">
            {t('ml.lab.multiclassDecision.testResult', {
              coverage: pct(editor.test.metrics.coverage),
              accuracy: pct(editor.test.metrics.accuracy),
            })}
          </p>
        )}
      </div>
      <p className="text-xs text-muted">
        {t(
          editor.phase === 'exploratory'
            ? 'ml.lab.multiclassDecision.exploratoryNote'
            : 'ml.lab.multiclassDecision.note',
        )}
      </p>
    </section>
  );
}

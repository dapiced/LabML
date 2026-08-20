import { MessageSquareText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Eyebrow } from '@/components/ui/eyebrow';
import { useLabStore } from '@/features/ml/lab-store';

/**
 * Rule-generated natural-language summary of the inspected model — no external
 * API involved, every sentence is derived from the computed metrics.
 */
export function PlainRead() {
  const { t, i18n } = useTranslation();
  const insights = useLabStore((s) => s.insights);
  const results = useLabStore((s) => s.results);
  const summary = useLabStore((s) => s.summary);
  if (!insights || !summary) return null;

  const result = results.find((r) => r.key === insights.model);
  const baseline = results.find((r) => r.key === 'baseline');
  if (!result?.ok) return null;

  const lang = i18n.resolvedLanguage ?? 'en';
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
      const delta = (result.metrics.accuracy ?? 0) - (baseline.metrics.accuracy ?? 0);
      sentences.push(
        t('ml.lab.insights.readBaseline', {
          delta: pct(delta),
          baseline: pct(baseline.metrics.accuracy ?? 0),
        }),
      );
    }
    if (insights.classes?.length === 2 && insights.confusion) {
      const [, positiveRow] = insights.confusion;
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

  return (
    <div data-testid="plain-read" className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-5">
      <Eyebrow className="flex items-center gap-2">
        <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
        {t('ml.lab.insights.readTitle')}
      </Eyebrow>
      <p className="max-w-3xl text-sm leading-relaxed">{sentences.join(' ')}</p>
    </div>
  );
}

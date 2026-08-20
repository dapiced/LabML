import { MessageSquareText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Eyebrow } from '@/components/ui/eyebrow';
import { buildPlainRead } from '@/features/ml/projects/report';
import { useLabStore } from '@/features/ml/lab-store';

/**
 * Rule-generated natural-language summary of the inspected model — no external
 * API involved; the sentence builder is shared with the exported HTML report.
 */
export function PlainRead() {
  const { t, i18n } = useTranslation();
  const insights = useLabStore((s) => s.insights);
  const results = useLabStore((s) => s.results);
  const summary = useLabStore((s) => s.summary);
  const meta = useLabStore((s) => s.meta);
  const target = useLabStore((s) => s.target);
  if (!insights || !summary || !meta || !target) return null;

  const text = buildPlainRead(
    {
      name: meta.name,
      createdAt: 0, // unused by the sentence builder

      dataset: { name: meta.name, rowCount: meta.rowCount, columnCount: meta.columnCount },
      target,
      taskType: summary.taskType,
      seed: summary.seed,
      results,
      summary,
      insights,
    },
    t,
    i18n.resolvedLanguage ?? 'en',
  );
  if (!text) return null;

  return (
    <div data-testid="plain-read" className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-5">
      <Eyebrow className="flex items-center gap-2">
        <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
        {t('ml.lab.insights.readTitle')}
      </Eyebrow>
      <p className="max-w-3xl text-sm leading-relaxed">{text}</p>
    </div>
  );
}

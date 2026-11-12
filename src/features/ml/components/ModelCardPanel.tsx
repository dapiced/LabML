import { ClipboardCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/eyebrow';
import { ModelCardDownloads } from '@/features/ml/components/ModelCardDownloads';
import { useLabStore } from '@/features/ml/lab-store';
import { CARD_FIELDS, cleanField, MAX_FIELD_LENGTH } from '@/features/ml/projects/model-card';

/**
 * V58: the model card of the current run. Everything on a card is read from
 * the run except what only its author knows: what the model is for. That is
 * asked here, and until it is answered the card says it is incomplete rather
 * than guessing a purpose.
 */
export function ModelCardPanel() {
  const { t } = useTranslation();
  const run = useLabStore((s) => s.currentRun);
  const setCardField = useLabStore((s) => s.setCardField);
  if (!run) return null;

  const complete = cleanField(run.card?.intendedUse) !== '';

  return (
    <section
      data-testid="model-card-panel"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4"
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-accent" aria-hidden="true" />
          <Eyebrow>{t('ml.lab.card.panelTitle')}</Eyebrow>
          <Badge variant="outline" data-testid="model-card-status">
            {t(complete ? 'ml.lab.card.statusComplete' : 'ml.lab.card.statusIncomplete')}
          </Badge>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-muted">{t('ml.lab.card.panelHint')}</p>
      </div>

      <div className="flex max-w-3xl flex-col gap-3">
        {CARD_FIELDS.map((field) => (
          <label key={field} className="flex flex-col gap-1 text-sm">
            {t(`ml.lab.card.field.${field}`)}
            <textarea
              data-testid={`model-card-${field}`}
              rows={field === 'owner' ? 1 : 2}
              maxLength={MAX_FIELD_LENGTH}
              value={run.card?.[field] ?? ''}
              placeholder={t(`ml.lab.card.placeholder.${field}`)}
              onChange={(event) => setCardField(field, event.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted"
            />
          </label>
        ))}
      </div>

      <ModelCardDownloads record={run} />
      <p className="max-w-3xl text-xs text-muted">{t('ml.lab.card.savedNote')}</p>
    </section>
  );
}

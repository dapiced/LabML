import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { noteText, type RunNote } from '@/features/ml/train/journal';

/**
 * V55: the run journal — what a run fell back from, said next to the result
 * it affects. Renders nothing when there is nothing to say, so a run where
 * every step succeeded looks exactly as it did before.
 */
export function RunNotes({
  notes,
  className,
}: {
  notes: RunNote[] | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  // A shared run is input from a stranger: anything but a list is nothing to show.
  if (!Array.isArray(notes) || notes.length === 0) return null;
  return (
    <div
      data-testid="run-notes"
      className={`flex items-start gap-2 text-sm ${className ?? ''}`}
      role="note"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
      <div>
        <p className="font-medium">{t('ml.lab.journal.title')}</p>
        <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted">
          {notes.map((note, index) => (
            <li key={`${note.code}-${note.model ?? ''}-${index}`}>{noteText(note, t)}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

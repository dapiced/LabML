/**
 * V55: the run journal — what a run fell back from, said out loud.
 *
 * Several steps of a run are best-effort by design: the ensemble is free and
 * optional, the parallel phase only buys time, a family that fails one fold of
 * the robust ranking still reports the others. Each of those fallbacks used to
 * be an empty `catch`: the run stayed usable and nobody could tell that part
 * of it was missing, or why. The fallbacks stay; the journal records them.
 *
 * It is bounded, like the error report (`app/errorReport.ts`), and it lives in
 * the run: shown with the leaderboard, carried into the HTML report, never
 * sent anywhere. A run with nothing to say carries no journal at all.
 */
import type { ModelKey } from '@/features/ml/train/types';

/** A closed list: every note is a decision the code took, not free text. */
export type RunNoteCode =
  /** The ensemble could not be built or scored: the families stand alone. */
  | 'ensemble-failed'
  /** A helper worker could not be started: its families were fitted in sequence. */
  | 'helper-unavailable'
  /** A helper worker crashed or reported an error mid-batch: same fallback. */
  | 'helper-failed'
  /** A model fitted by a helper could not be rebuilt: it was fitted again in sequence. */
  | 'helper-rebuild-failed'
  /** A family failed a fold of the robust ranking: its mean covers fewer folds. */
  | 'fold-failed';

export interface RunNote {
  code: RunNoteCode;
  /** The family concerned, when the note is about one. */
  model?: ModelKey;
  /** The error message, truncated. Diagnostic text, never an instruction. */
  detail?: string;
  /** How many times the same thing happened, when more than once. */
  count?: number;
}

export const MAX_NOTES = 20;
export const MAX_DETAIL = 200;

export interface Journal {
  /** Records a fallback. `cause` is whatever was caught, if anything was. */
  add(code: RunNoteCode, model?: ModelKey, cause?: unknown): void;
  /** The notes in the order they first happened. Empty when nothing did. */
  notes(): RunNote[];
}

function detailOf(cause: unknown): string | undefined {
  if (cause === undefined || cause === null) return undefined;
  const text = cause instanceof Error ? cause.message : String(cause);
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat === '') return undefined;
  return flat.length > MAX_DETAIL ? `${flat.slice(0, MAX_DETAIL - 1)}…` : flat;
}

export function createJournal(max = MAX_NOTES): Journal {
  const kept: RunNote[] = [];
  return {
    add(code, model, cause) {
      // The same fallback for the same family is one note with a count: ten
      // failed folds are one fact, not ten lines.
      const same = kept.find((note) => note.code === code && note.model === model);
      if (same) {
        same.count = (same.count ?? 1) + 1;
        return;
      }
      if (kept.length >= max) return;
      const detail = detailOf(cause);
      kept.push({
        code,
        ...(model !== undefined && { model }),
        ...(detail !== undefined && { detail }),
      });
    },
    notes: () => kept.map((note) => ({ ...note })),
  };
}

/** The `notes` key of a summary or a result: absent when there is nothing to say. */
export function notesField(journal: Journal): { notes?: RunNote[] } {
  const notes = journal.notes();
  return notes.length > 0 ? { notes } : {};
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * One note as a sentence, for the interface and the HTML report alike. The
 * caller escapes the result where it needs to: `detail` may come from a share
 * link, which is input from a stranger.
 */
export function noteText(note: RunNote, t: Translate): string {
  const text = t(`ml.lab.journal.${note.code}`, {
    model: note.model !== undefined ? t(`ml.lab.models.${note.model}`) : '',
    count: note.count ?? 1,
  });
  return note.detail ? `${text} (${note.detail})` : text;
}

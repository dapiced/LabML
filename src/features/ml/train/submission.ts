/**
 * V65: a file a competition platform accepts.
 *
 * Scoring a batch (V7) gives back every original column plus the prediction:
 * the right file to join back into a system, the wrong one for a platform
 * that expects two columns under its own names, `PassengerId,Survived`.
 *
 * The lab knows neither the platform nor its rules, so it guesses nothing:
 * the user names the identifier column, the prediction column and what a
 * prediction is (a label, a probability, a value). The lab keeps one promise,
 * that the file has exactly the rows of the scored file, in their order, and
 * counts what a platform would refuse: an identifier missing or repeated.
 *
 * Which model predicts is the other half of the wave, see `refit.ts`.
 * Measured before building, on the six demos, ten splits each, with a
 * quarter of the rows kept away from both models as a private set. The same
 * family fitted on every labelled row instead of 64 % of them:
 *
 *   demo      labelled rows   mean gain on the private set   better / worse
 *   reviews       180         +5.0 accuracy points           51 / 11 of 70
 *   mpg           298         RMSE down 3 %                  47 / 13 of 60
 *   energy        180         RMSE down 2 %                  44 / 16 of 60
 *   titanic       668         +0.8 accuracy point            41 / 20 of 70
 *   fraud         480         none (-0.04 point)             21 / 25 of 70
 *   iris          112         none (-0.1 point)              14 / 17 of 70
 *
 * The gain follows the learning curve, not the size of the file: iris is the
 * smallest demo and gains nothing, because 72 rows already say all there is
 * to say. Where the curve still climbs the refit pays, and even there it
 * loses one time in five to one time in three. So the refit is offered and
 * never the default, and it is announced for what it is: a model nobody
 * measured.
 *
 * Pure and deterministic.
 */
import { isMissing } from '@/features/ml/data/infer';
import type { Cell } from '@/features/ml/data/types';
import type { ModelKey } from '@/features/ml/train/types';
import { csvCell } from '@/lib/csv';

/**
 * What one prediction is, in the file:
 * - `label`: the predicted class, by name;
 * - `probability`: the probability of the second class (binary only);
 * - `probabilities`: one column per class, named after it (three classes or more);
 * - `value`: the predicted number (regression).
 */
export type SubmissionForm = 'label' | 'probability' | 'probabilities' | 'value';

const PREVIEW_LINES = 4;
/** Six decimals: below what any leaderboard metric can tell apart. */
const PROBABILITY_DIGITS = 6;

/** The forms that make sense for a task. A form with no object is not offered. */
export function formsFor(
  isClassification: boolean,
  classCount: number,
  hasProbabilities: boolean,
): SubmissionForm[] {
  if (!isClassification) return ['value'];
  if (!hasProbabilities) return ['label'];
  return classCount === 2 ? ['label', 'probability'] : ['label', 'probabilities'];
}

export interface SubmissionInput {
  /** Identifier cells of the scored file, or null to number the rows from 1. */
  ids: readonly Cell[] | null;
  idName: string;
  /** Unused by `probabilities`, whose columns carry the class names. */
  predictionName: string;
  form: SubmissionForm;
  predictions: readonly number[];
  probabilities: readonly (readonly number[])[] | null;
  classes: readonly string[];
  isClassification: boolean;
}

export interface SubmissionFile {
  csv: string;
  header: string[];
  /** Data rows written: always the row count of the scored file. */
  rows: number;
  /** Rows whose identifier cell is empty. They are written, and counted. */
  missingIds: number;
  /** Rows whose identifier was already used by an earlier row. */
  duplicateIds: number;
  /** Predicted classes and their counts, most frequent first (`label`). */
  counts?: { label: string; count: number }[];
  /** Spread of the written numbers (`probability`, `value`). */
  range?: { min: number; max: number; mean: number };
  /** First lines of the file, header included. */
  preview: string[];
}

/** What crosses the worker boundary: the file, and which model predicted it. */
export interface Submission extends SubmissionFile {
  fileName: string;
  model: ModelKey;
  form: SubmissionForm;
  /** Set when the family was fitted again on every labelled row. */
  refit: { rows: number; fittedRows: number } | null;
}

function probabilityText(value: number): string {
  return String(Number(value.toFixed(PROBABILITY_DIGITS)));
}

/**
 * Throws a named error when the request cannot give a file a platform would
 * read: `name-empty`, `name-clash`, `form-unavailable`, `rows-mismatch`.
 */
export function buildSubmission(input: SubmissionInput): SubmissionFile {
  const { ids, form, predictions, probabilities, classes, isClassification } = input;
  const idName = input.idName.trim();
  const predictionName = input.predictionName.trim();
  const classCount = classes.length;
  if (!formsFor(isClassification, classCount, probabilities !== null).includes(form)) {
    throw new Error('form-unavailable');
  }
  if (ids !== null && ids.length !== predictions.length) throw new Error('rows-mismatch');
  if (idName === '') throw new Error('name-empty');

  const header = form === 'probabilities' ? [idName, ...classes] : [idName, predictionName];
  if (form !== 'probabilities' && predictionName === '') throw new Error('name-empty');
  if (new Set(header).size !== header.length) throw new Error('name-clash');

  let missingIds = 0;
  let duplicateIds = 0;
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  const note = (value: number) => {
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  };

  const lines = [header.map(csvCell).join(',')];
  for (let row = 0; row < predictions.length; row++) {
    let id: string;
    if (ids === null) {
      id = String(row + 1);
    } else {
      const cell = ids[row];
      id = isMissing(cell) ? '' : String(cell).trim();
      if (id === '') missingIds += 1;
      else if (seen.has(id)) duplicateIds += 1;
      else seen.add(id);
    }

    const cells = [csvCell(id)];
    const predicted = predictions[row];
    if (form === 'label') {
      const label = classes[predicted] ?? String(predicted);
      counts.set(label, (counts.get(label) ?? 0) + 1);
      cells.push(csvCell(label));
    } else if (form === 'value') {
      note(predicted);
      cells.push(String(predicted));
    } else if (form === 'probability') {
      const value = probabilities![row][1] ?? 0;
      note(value);
      cells.push(probabilityText(value));
    } else {
      for (const value of probabilities![row]) cells.push(probabilityText(value));
    }
    lines.push(cells.join(','));
  }

  const rows = predictions.length;
  return {
    csv: lines.join('\n') + '\n',
    header,
    rows,
    missingIds,
    duplicateIds,
    ...(form === 'label' && {
      counts: [...counts]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    }),
    ...((form === 'value' || form === 'probability') &&
      rows > 0 && { range: { min, max, mean: sum / rows } }),
    preview: lines.slice(0, PREVIEW_LINES + 1),
  };
}

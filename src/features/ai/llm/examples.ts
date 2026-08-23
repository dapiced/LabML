/**
 * V30 (C) — examples built from the user's OWN columns, for 0 MB.
 *
 * V27's prompt ended with nine worked examples written against Titanic:
 * `age`, `fare`, `sex`, `embark_town`. Every user got them, whatever their
 * file held — and the prompt then had to spend a rule (« the examples below
 * describe a DIFFERENT table, never reuse a column name from them ») asking
 * the model to ignore what it had just been shown. Measured on the V30 corpus,
 * that rule did not always hold: on « which 5 decks have the highest average
 * fare? » the model answered with a filter on `deck` rather than a top-k, and
 * on several questions it reached for a column the question never mentioned.
 *
 * Asking a 0.6B model to ignore its most recent, most concrete input is a bad
 * bet. So the examples are now written in the user's own vocabulary: the
 * columns in them are columns that exist, and copying one is no longer a
 * mistake. It costs nothing to download and it deletes a rule.
 *
 * When a table has no numeric column, or no small categorical one, the
 * examples that would need one are simply left out. A made-up column in an
 * example is exactly the failure this module exists to remove.
 */
import type { ColumnInfo } from '@/features/ai/chat/parser';

/** A category set worth quoting: small enough to list, big enough to filter on. */
const MAX_VALUES = 12;
/**
 * Above this many distinct values a numeric column is a QUANTITY — something
 * an average is about. Below it, it is a flag or a code: on Titanic, taking the
 * first numeric column gave `survived`, so the examples read « average
 * survived » and « survived moyen par sex », and the model duly answered other
 * questions with that column. Measured on the corpus before the fix: three of
 * the nine remaining wrong answers named `survived` for no reason in the
 * question.
 */
const MEASURE_DISTINCT = 6;

export interface ExampleColumns {
  numeric: ColumnInfo | null;
  otherNumeric: ColumnInfo | null;
  categorical: ColumnInfo | null;
  otherCategorical: ColumnInfo | null;
}

export function pickExampleColumns(columns: ColumnInfo[]): ExampleColumns {
  const allNumbers = columns.filter((column) => column.isNumeric);
  // A column whose distinct count was never taken is given the benefit of the
  // doubt: the field is an improvement to the examples, never a gate.
  const measures = allNumbers.filter(
    (column) => column.distinct === undefined || column.distinct > MEASURE_DISTINCT,
  );
  const numbers = measures.length > 0 ? measures : allNumbers;
  const categories = columns.filter(
    (column) =>
      !column.isNumeric && column.values.length >= 2 && column.values.length <= MAX_VALUES,
  );
  return {
    numeric: numbers[0] ?? null,
    otherNumeric: numbers[1] ?? null,
    categorical: categories[0] ?? null,
    otherCategorical: categories[1] ?? null,
  };
}

const json = (value: unknown) => JSON.stringify(value);

/**
 * The worked examples, in the user's own column names. Each line is
 * `Q: <question> -> <json>`; the JSON is built rather than written out, so an
 * example can never drift out of the grammar the answer is validated against.
 */
export function buildExamples(columns: ColumnInfo[]): string[] {
  const { numeric, otherNumeric, categorical, otherCategorical } = pickExampleColumns(columns);
  const lines: string[] = [];
  const add = (question: string, intent: unknown) =>
    lines.push(`Q: ${question} -> ${json(intent)}`);

  // Order and coverage are both measured, not chosen by taste. The first
  // version of this list left out the aggregate-WITH-FILTER shape, which V27's
  // hand-written examples had, and the bench fell from 45 to 34 correct out of
  // 55: without an example of « an average over a subset », the model reached
  // for a count with an invented threshold — `{"column":"fare","op":"=",
  // "value":1000000000}` on « prix moyen payé par les survivants ». Under
  // constrained decoding it CANNOT write malformed JSON, so a shape it has not
  // been shown comes out as a confident wrong answer instead of a refusal.
  if (numeric) {
    const name = numeric.name;
    add(`average ${name}`, { kind: 'aggregate', op: 'mean', column: name });
    if (categorical) {
      add(`average ${name} for ${categorical.values[0]}`, {
        kind: 'aggregate',
        op: 'mean',
        column: name,
        filter: { column: categorical.name, op: '=', value: categorical.values[0] },
      });
      add(`${name} moyen par ${categorical.name}`, {
        kind: 'aggregate',
        op: 'mean',
        column: name,
        groupBy: categorical.name,
      });
      // The shape V27.2 had to add a rule for: a question comparing two groups
      // is a grouped aggregate, and the example now says so in the user's own
      // column names rather than in Titanic's.
      add(`est-ce que ${name} change selon ${categorical.name} ?`, {
        kind: 'aggregate',
        op: 'mean',
        column: name,
        groupBy: categorical.name,
      });
    }
  }

  add('combien de lignes ?', { kind: 'count' });
  if (categorical) {
    add(`how many rows where ${categorical.name} is ${categorical.values[0]}?`, {
      kind: 'count',
      filter: { column: categorical.name, op: '=', value: categorical.values[0] },
    });
  }
  if (numeric) {
    add(`combien de lignes où ${numeric.name} est inférieur à 10 ?`, {
      kind: 'count',
      filter: { column: numeric.name, op: '<', value: 10 },
    });
  }

  // One refusal example, in the middle. Two of them, at the end, was measured
  // at eleven refusals out of 55 against two — the last examples are the ones
  // a small model imitates hardest, and refusing is not what it should imitate.
  add('quelle est la capitale de la France ?', { kind: 'none' });

  if (categorical) {
    add(`répartition de ${categorical.name}`, {
      kind: 'distribution',
      column: categorical.name,
    });
  }
  if (numeric && otherNumeric) {
    add(`lien entre ${numeric.name} et ${otherNumeric.name}`, {
      kind: 'correlation',
      a: numeric.name,
      b: otherNumeric.name,
    });
  }
  if (numeric && categorical) {
    add(`top 3 ${categorical.name} par ${numeric.name} moyen`, {
      kind: 'topk',
      groupBy: categorical.name,
      k: 3,
      op: 'mean',
      column: numeric.name,
    });
  }
  if (categorical && otherCategorical) {
    add(`les 3 ${otherCategorical.name} les plus fréquents`, {
      kind: 'topk',
      groupBy: otherCategorical.name,
      k: 3,
      op: 'count',
    });
  }
  add('how many rows and columns?', { kind: 'shape' });
  return lines;
}

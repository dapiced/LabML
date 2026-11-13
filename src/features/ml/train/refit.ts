/**
 * V65: one family, fitted again on every labelled row.
 *
 * A run fits on 64 % of the rows and keeps 16 % to choose and 20 % to
 * measure. Once the choice is made and the measure taken, those 36 % have
 * done their work, and a prediction for rows nobody has labelled can use
 * them too. The price is stated wherever this model is used: it has no test
 * set left. Its score is the one of the model fitted on fewer rows.
 *
 * Nothing else changes: the same columns, the same seed, the same announced
 * caps (V25), the same class weighting. The preprocessing is fitted again on
 * all the rows, so a category or a word that only the held-out rows carried
 * now has its own column.
 *
 * Pure and deterministic.
 */
import { balancedWeights } from '@/features/ml/train/class-weight';
import { MODEL_TRAIN_CAPS, modelZoo, type TrainedModel } from '@/features/ml/train/models';
import { fitPipeline, type FittedPipeline } from '@/features/ml/train/pipeline';
import { nestedSampleOrder } from '@/features/ml/train/random';
import { prepareData } from '@/features/ml/train/trainer';
import type { Cell, ColumnProfile } from '@/features/ml/data/types';
import type { ModelKey, TrainConfig } from '@/features/ml/train/types';

export interface Refit {
  model: TrainedModel;
  pipeline: FittedPipeline;
  /** Labelled rows the run had: train, validation and test together. */
  rows: number;
  /** Rows the family was fitted on: fewer than `rows` when its cap applies. */
  fittedRows: number;
  classes: string[];
  isClassification: boolean;
}

/** Null when the run does not train this family (a regression has no logistic). */
export function refitOnAllRows(
  columns: Map<string, Cell[]>,
  profiles: ColumnProfile[],
  config: TrainConfig,
  key: ModelKey,
): Refit | null {
  const prepared = prepareData(columns, profiles, config);
  const { isClassification, classes, encode } = prepared;
  const definition = modelZoo(isClassification ? 'classification' : 'regression').find(
    (candidate) => candidate.key === key,
  );
  if (!definition) return null;

  // Original order: a model must not depend on which split a row came from.
  const rows = [...prepared.train, ...prepared.validation, ...prepared.test].sort((a, b) => a - b);
  const pipeline = fitPipeline(columns, profiles, prepared.featureColumns, rows);
  let x = pipeline.transform(rows);
  let y = rows.map(encode);

  const cap = MODEL_TRAIN_CAPS[key];
  if (cap !== undefined && rows.length > cap) {
    const labels = isClassification ? y.map((label) => classes[label] ?? null) : null;
    const keep = nestedSampleOrder(rows.length, labels, config.seed)
      .slice(0, cap)
      .sort((a, b) => a - b);
    x = keep.map((position) => x[position]);
    y = keep.map((position) => y[position]);
  }

  const weights =
    config.classWeighting === 'balanced' && isClassification
      ? balancedWeights(y, classes.length)
      : undefined;
  const model = definition.train(x, y, {
    task: isClassification ? 'classification' : 'regression',
    classCount: classes.length,
    seed: config.seed,
    ...(weights !== undefined && { classWeights: weights }),
  });
  return { model, pipeline, rows: rows.length, fittedRows: y.length, classes, isClassification };
}

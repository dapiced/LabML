# V50: metrics that agree with the reference on every edge

## Measured first

| Edge                             | Before                          | Reference                       |
| -------------------------------- | ------------------------------- | ------------------------------- |
| Perfect batch, 2 of 3 classes    | macro F1 0.667                  | scikit-learn 1.0                |
| Rare class, 1 row (100 + 1 rows) | test 1, train 0                 | the class is never learned      |
| Rare class, 2 rows               | test 1, validation 1, train 0   | the class is never learned      |
| Empty set                        | RMSE 0, MAE 0, R² 1, accuracy 0 | undefined (scikit-learn raises) |

Demo targets with one-row classes: titanic → parch, cafe-sales → city,
cafe-sales → product.

## Decomposition on titanic → parch (macro F1 per model)

| Configuration         | GBDT  | Forest | Ensemble |
| --------------------- | ----- | ------ | -------- |
| old split, old metric | 0.619 | 0.310  | 0.422    |
| old split, new metric | 0.619 | 0.310  | 0.422    |
| new split, old metric | 0.614 | 0.340  | 0.470    |
| new split, new metric | 0.716 | 0.397  | 0.548    |

The metric alone changes nothing while every class is in the test split. Once
one-row classes stay in training, the test split no longer holds them and the
new average stops counting them as zeros. The validation-picked winner moves
from GBDT to the forest because the validation rows changed.

## Changes

- `macroPrf` and `evaluateMulticlassPolicy`: average over classes present in
  the true labels or the predictions/decisions.
- `splitIndices`: a one-row class stays in training; the RNG draw for every
  other class is unchanged.
- `runTraining`: `too-few-rows` when the split leaves train or test empty.
- Every metric over zero rows returns NaN.
- `tests/golden/generate.py`: new `absentClass` case, regenerated with
  scikit-learn 1.7.2 (Python 3.13.16).

## Tests

`src/features/ml/train/metric-edges.test.ts` (6 of 7 fail before) and the new
golden case (fails before).

## Not done

A rare-class warning in the interface, and a guard for k-fold tuning on fewer
than four training rows.

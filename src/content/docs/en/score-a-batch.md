---
slug: scorer-un-lot
kind: how-to
order: 1
title: Score a new batch of data
summary: You have a trained model and a file of rows to predict. Here is the gesture, and what LabML checks before accepting.
---

This assumes you have already trained a model. If not, start with the
[tutorial](/docs/premier-modele).

## The gesture

1. Below the leaderboard, open **Score a new batch**.
2. Drop the file — CSV, TSV or Excel.
3. Predictions appear row by row, exportable as CSV.

:::try /ml?demo=iris&target=species | Train iris to try it with iris-field.csv

## What LabML checks before accepting

The file must carry the columns the model expects. If any are missing, LabML
**refuses and names them** (`missing-columns`) rather than predicting over
absent features.

Extra columns are ignored without noise: a production export often carries
identifiers the model never needed.

The batch is read like the training file was, under the same memory budget. A
batch past 20 million cells is refused (`too-large`) rather than read whole.

## If the file contains the real answer

Then LabML does not merely predict: it compares, and shows the same metrics as
the leaderboard.

This is the most useful production gesture — checking that a model still holds
on data it has never seen. Whether a gap against the test score is a real drop
or the draw of a small batch is what the production check below settles.

## The production check

Every scored batch is read against what the model was trained on, and the panel
gives one verdict with its three signals.

| Signal      | Question                                         | Needs                         |
| ----------- | ------------------------------------------------ | ----------------------------- |
| Columns     | do the inputs still look like the training rows? | nothing more                  |
| Answers     | does the model still answer the way it did?      | nothing more                  |
| Performance | is it wrong more often?                          | the target column in the file |

| Verdict     | When                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------- |
| **Stable**  | nothing can be told from the draw                                                               |
| **Watch**   | columns or answers moved, and the performance did not measurably drop, or could not be measured |
| **Retrain** | on the labelled rows, the drop is outside its interval                                          |

Two rules, stated on the panel:

- **a drift is a reason to look, a measured drop is a reason to retrain.**
  Without labels the verdict stops at « watch », and asks for labels;
- **a drift counts only when it can be told from the draw.** Each PSI is read
  against its own noise ceiling: the value it stays under, 95 checks in 100,
  when the batch and the reference are two draws of the same data at these
  sizes. The usual fixed thresholds (0.1 and 0.25) read a small batch as a
  drift: on the lab's demos they raised a strong alert on 8 to 78 % of 100-row
  batches in which nothing had moved, and on nearly all 30-row ones.

A model re-imported from a file carries its reference with it (format 5). An
older export has none: the panel says so, and checks the batch on its labels
alone.

## The decision columns

If the scored model carries a multiclass decision rule — frozen in the lab, then
exported with it — the produced CSV gains two columns:

| Column            | Contents                                                                 |
| ----------------- | ------------------------------------------------------------------------ |
| `policy_decision` | The class the rule settled on, or an empty cell when the rule abstained. |
| `decision_status` | `decided` or `abstained`.                                                |

The `predicted` column stays the model's raw prediction. The two decision
columns do not replace it: they say what the rule chose to do with it. An
abstained row is a case to route to human review, not a model error.

With no rule attached to the model, these columns do not appear at all.

## Labels never seen

If your batch contains a class absent from training, LabML still predicts it
but **excludes it from the metrics**, announcing how many rows are affected.
The model cannot predict a class it never met; counting it in accuracy would
distort it.

## Where to go next

- [Compare two runs](/docs/comparer-deux-runs) if the score moved.
- The [refusals table](/docs/refus) if the file was refused.

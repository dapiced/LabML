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

## If the file contains the real answer

Then LabML does not merely predict: it compares, and shows the same metrics as
the leaderboard.

This is the most useful production gesture — checking that a model still holds
on data it has never seen. A clear gap against the test score is a drift
signal, to investigate in the [Data Studio](/docs/reference-data).

## Labels never seen

If your batch contains a class absent from training, LabML still predicts it
but **excludes it from the metrics**, announcing how many rows are affected.
The model cannot predict a class it never met; counting it in accuracy would
distort it.

## Where to go next

- [Compare two runs](/docs/comparer-deux-runs) if the score moved.
- The [refusals table](/docs/refus) if the file was refused.

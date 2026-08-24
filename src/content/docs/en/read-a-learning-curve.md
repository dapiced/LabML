---
slug: lire-une-courbe
kind: how-to
order: 3
title: Read a learning curve
summary: Answer « should I collect more data? » with a graph rather than an intuition.
---

## The gesture

1. Train a model.
2. Open **Would more data help?** below the leaderboard.
3. Choose a model and trace the curve.

LabML retrains that model on **growing, nested** fractions of the training set,
and scores each one on the **same full test set**.

## How to read it

Look at the **right edge** of the curve.

| What you see         | What it means                                      | What to do                                    |
| -------------------- | -------------------------------------------------- | --------------------------------------------- |
| It is still climbing | The model has not finished learning from your data | Collecting more rows is worth it              |
| It is flat           | More rows will change nothing                      | Work on the features, or change model         |
| It climbs then falls | Rare; often a sign of leakage or a doubtful split  | Check the [leak detector](/docs/reference-ml) |

The band around the curve is a bootstrap interval. If it is wide at the right
edge, the slope you think you see may be noise.

## Why nested fractions

Each size is a **prefix** of the next: the first 200 rows are inside the first 400. Without that, each point would draw a different sample and the curve would
measure the luck of the draw as much as the effect of size.

## What the curve does not say

It does not say how many rows would be needed. Extrapolating a learning curve
beyond what was measured is a guess, and LabML does not offer one.

## Where to go next

- [Compare two runs](/docs/comparer-deux-runs) to measure a change of features.
- [The method choices](/docs/methode) on why the baseline comes first.

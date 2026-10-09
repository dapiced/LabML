---
slug: reference-ml
kind: reference
order: 2
title: Reference — ML Lab
summary: What each ML Lab panel does, what it computes exactly, and what it does not claim to do.
---

To consult, not to read. One panel per section, in the order they appear below
the leaderboard.

:::try /ml?demo=titanic&target=survived | Open the ML Lab with titanic ready

## Reading the file

The file is read in the browser. Encoding is settled **by trying**: UTF-8 in
strict mode throws on cp1252 accents, so the fallback is a certainty rather than
a preference. The delimiter is the candidate that splits every sampled line into
the same number of columns. The decimal separator is decided **per column**,
never per file, and a column is rewritten only when at least 90% of its values
are numbers in that form.

The reading is announced with its counts when it departs from the default. A
plain UTF-8 comma file gets no card: no friction for the ordinary case.

## Profile and choosing the target

Every column gets an inferred type (numeric, categorical, boolean, text, date),
its distinct count, its missing rate and its extremes. Choosing a target
triggers task detection (binary, multi-class, regression) and **leak
detection**: a column that almost perfectly mirrors the target is excluded
automatically and named.

While a run trains, and while anything computed from it is running
(hyperparameter search, learning curve, robust ranking, batch scoring), the
target and the columns are **locked**. Changing them at that moment would file
results under a question they do not answer; wait for the end or cancel.

## Training and the leaderboard

Eight hand-written families, plus an ensemble, plus a naive baseline. Split
**64 / 16 / 20** — training, validation, test — seeded at 42.

The winner is **elected on validation**; the published figure comes from the
**test** set, never touched to choose. The gap between the two is displayed:
that is the price of selection, and hiding it would make the score flattering.

The baseline always answers the majority class (or the mean for regression). A
model that does not beat it has learned nothing, whatever its absolute score.

The split is stratified by class. A class with **a single row** stays on the
training side: sending it to test would leave the models with no example of it
at all. If every class has a single row, nothing is left to test on, and
training refuses with `too-few-rows` rather than publishing metrics computed
over an empty set.

Precision, recall and F1 are **macro** averages, computed as scikit-learn does:
over the classes present in the true labels or in the predictions. A class
absent from both does not count as a zero; a class that is predicted but never
true does, because those predictions are all wrong.

## How solid the numbers are

The test set is bootstrap-resampled 1,000 times and the metric recomputed each
time; the interval is where it lands 95 times out of 100. Draws are **paired**
across models, so comparisons are legitimate. These intervals measure
sensitivity to the test draw — **not** training variance, and the panel says so.

A wide interval is information, not a defect.

## Is the ranking real?

On demand: 5 repetitions × 2 halves, ten fits per family, with a mean, a spread,
and how often the leader actually beat the runner-up. The test set stays **out**
of the folds: this re-ranks, it does not re-test.

## Hyperparameter search

Seeded random search, up to 16 configurations, scored by 3-fold cross-validation
**on the training split only**. The test set is scored exactly once, at the end.

## Learning curve

One model retrained on growing, nested fractions of the training split, each
scored on the same full test set, with a bootstrap band. If the curve is still
climbing at the right edge, collecting more rows is worth it; if it is flat,
work on features or the model.

## Explanations

- **Plain read**: the score, the gap to the baseline, recall, the decisive
  columns.
- **Confusion matrix**, **ROC curve**, **permutation importance**
  (model-agnostic: the accuracy drop when the column is shuffled).
- **Partial dependence**: the average prediction as a column sweeps its range,
  everything else unchanged.
- **What-if**: edit the values, the prediction recomputes locally.

## Decision threshold

Precision-recall curve, calibration curve, and a threshold **you** decide,
priced by your false-alarm and missed-case costs. A probability is not a
decision; the threshold is saved with the run.

## Deciding across several classes

Past two classes, a single slider no longer cuts it. The multiclass decision
panel gives you **one threshold per class** and a rule stated out loud: a class
is a candidate when its probability reaches its own threshold; among candidates,
the one with the largest normalized margin wins; ties are broken by class order,
always the same order.

When no class clears its threshold, the rule **abstains** and says so. It does
not quietly fall back to the most probable class — that silent fallback is
exactly what a threshold exists to prevent. Setting every threshold to zero
reproduces argmax exactly, with full coverage: the default rule changes nothing
until you ask it to.

Two accuracies sit side by side: overall accuracy, where an abstention counts as
an error, and accuracy conditional on the decided rows. The first answers "how
good is the system", the second "how good is the rule when it commits".

The editor works on the **validation split**, never on test. You freeze the rule
before revealing the test result; changing it afterwards marks that result as
exploratory rather than pretending it was earned blind. With no validation split
— a dataset too small, for instance — the panel explains why it is absent.

## Where the model fails

The test set is sliced by each categorical column — **including those outside
the features**, where proxy effects can hide. Slices under 8 rows are excluded.
A gap is a lead to investigate, not a verdict.

## Export, import, score

The model exports to JSON with its manifest: family, pipeline, versions. It
re-imports into a fresh session and scores a CSV. A frozen multiclass decision
rule travels with the export, and the scored CSV then carries two extra columns
— see [the formats page](/docs/formats). The five named import refusals are on
the [refusals page](/docs/refus).

A share link carries the run's metrics and charts in the URL fragment, never
the data. A cut or damaged link never yields a half-read page: if it does not
decode, or if part of the run it carries does not have the shape LabML writes,
the page refuses to show it and says why.

## Comparing runs

Two runs side by side (`/ml/compare/:a/:b`) or up to six
(`/ml/compare-many/:ids`): configuration, features added or removed, per-model
leaderboard, cross-run uncertainty.

## Where to go next

- [Score a new batch](/docs/scorer-un-lot), [compare two runs](/docs/comparer-deux-runs), [read a curve](/docs/lire-une-courbe) — the gestures, one per page.
- [The method choices](/docs/methode) — why the baseline, the intervals and seed 42.

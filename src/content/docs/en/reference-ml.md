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

## The run journal

Some steps of a run are best-effort: the ensemble is optional, the helper
workers only buy time, a family that fails one fold of the robust ranking still
reports the others. When one of them gives up, the run stays usable and the
**run journal** says what happened, next to the result it affects and in the
HTML report: which step, which family, how many times, and the error it met.

A run where every step succeeded shows no journal at all. The journal stays in
the run; nothing is sent anywhere.

## How solid the numbers are

The test set is bootstrap-resampled 1,000 times and the metric recomputed each
time; the interval is where it lands 95 times out of 100. Draws are **paired**
across models, so comparisons are legitimate. These intervals measure
sensitivity to the test draw — **not** training variance, and the panel says so.

A wide interval is information, not a defect.

## Has this test set been used too much?

Inside one run, validation chooses the winner and the test set only measures
it. Across runs nothing enforced that rule: train, read the test score, drop a
column, train again, keep the better of the two, and the test set has just
chosen. The score that survives is the luckier one.

The **test-set ledger** counts, for the file and target you are working on, how
many **distinct configurations** the current test set has scored. A
configuration is a set of columns plus the class weighting. Training the same
one again counts for nothing: the lab is deterministic, the numbers are the
same, and reading a number twice chooses nothing.

| Runs scored | What the panel says                                         |
| ----------- | ----------------------------------------------------------- |
| 1           | a measurement: nothing was chosen with it                   |
| 2 to 4      | comparing is already choosing; the effect is small          |
| 5 to 9      | **worn**: read the best score as optimistic                 |
| 10 and more | **spent**: the test set no longer tells better from luckier |

The two marks were measured, not taken from a formula. On the three demos, a
user who keeps the best test score of 5 configurations sees it 0.2 to 0.8 times
the split-to-split noise above what the same configuration gets on another
split, and up to that noise itself from 10. On titanic that is +1.7 accuracy
points at 5 runs. The closer the configurations really are, the more the best
one is only the luckiest.

From the worn mark the panel offers a **fresh split**: the next seed, a test
set this file never had. Train once the configuration you settled on, and read
that score. Three things to know:

- a fresh split deals **the same rows** again. It is not new data, and the
  panel counts how many splits the file has been dealt;
- the offer waits for the worn mark on purpose: a split redrawn at will is one
  more thing to shop with;
- a **chronological** split has one test set, the newest rows. No other draw
  exists, and the panel says that only newer data can replace it.

The ledger is kept in this browser, apart from the runs: deleting a run does
not un-read its test set. It stores a fingerprint of each configuration, never
a column name or a row. The count as it stood joins the run, its report and the
limits of its model card.

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

## Prediction sets

A prediction is one answer; it does not say how sure the model is of this row.
The prediction-sets panel makes the model answer with a **set of classes** («
cat or lynx »), or a **value with a margin** (« 42 ± 6 »), sized so the truth
falls inside at the rate you choose: 80, 90 or 95 %. A wide answer is the model
saying it cannot tell.

The method is split conformal prediction. On rows the model was not fitted on,
the lab measures how wrong it is, takes the quantile of those errors at the
level asked, and uses it as a threshold for any new row.

The lab does not ask to be believed. The threshold is calibrated on one half
of the test split and **measured on the other**, both ways, and the measured
coverage is shown beside the target with its interval. The validation split is
not used: it chose the winning model, which makes its errors look smaller than
they are.

Three limits, stated on the panel too:

- the promise is an **average** over rows like these, not a promise for each
  class, each segment or each row;
- it stops holding when new data drift away from the data of the run;
- a regression margin is the same for every row.

When the test split is too small for the level asked (95 % needs 19 rows per
half), no threshold is given and the panel says how many rows are missing.

## Decision threshold

Precision-recall curve, calibration curve, and a threshold **you** decide,
priced by your false-alarm and missed-case costs. A probability is not a
decision; the threshold is saved with the run.

The « best for these costs » suggestion is picked on the **validation** split,
and the figures beside it are measured on the test set, which had no say in the
choice. A threshold picked on the test set would be fitted to it, and its
metrics would stop being a measurement. When a run has no validation split
holding both classes, no threshold is suggested and the panel says why.

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

## Does the model treat groups differently?

The segment analysis looks at every column and asks where the model is weakest.
The **group audit** asks another question, about **one column you name**: a
model can be 80 % accurate everywhere and still say « yes » to most of one group
and few of another, or miss more real cases in one of them.

For a binary target each group gets three rates, each with an interval:

- **said « yes »**: the share predicted positive (the gap between groups is
  demographic parity);
- **real cases found**: the share of true positives found (equal opportunity);
- **false alarms**: the share of true negatives flagged.

Every gap is read against the largest group and carries its own interval. When
the interval contains zero, the gap is inside the noise. That is **not** proof
of equal treatment: with few rows, only a large gap would show, and the panel
says so. A multiclass target gets the share of correct answers per group; a
regression gets the mean error, signed and absolute.

Three rules, stated on the panel:

- **the lab does not decide which column is sensitive**: you name it, and
  nothing runs until you do. A column kept out of the features can be audited
  too: a model can reach it through other columns that stand in for it;
- **a gap is a finding, not a verdict**: no legal threshold is applied and
  nothing is corrected;
- **a group too small is not compared**: under 20 test rows it is listed with
  its size, and a rate resting on fewer than 10 cases is not computed.

The decision audited is the one you set: the threshold chosen in the decision
panel when there is one, the model's own answer otherwise.

## The model card

The run report is a technical account for whoever trained the model. The
**model card** is for whoever must decide to use it or approve it: what the
model is for, what it was built on, what it is worth, where it fails, and what
was never checked. It downloads as HTML or Markdown, from the run on screen and
from any stored or shared run.

Two rules shape it:

- **Nothing is invented.** The intended use, what the model must not be used
  for and who answers for it are typed by you. Left empty, the card writes « not
  stated » and says on top that it is incomplete. It does not guess a purpose.
- **What was not assessed is listed.** An analysis nobody ran (the robust
  ranking, the segments, the prediction sets…) appears under « Not assessed »
  instead of disappearing. A group audit that was never run is listed there
  too: a silent card would read as « checked, nothing found ».

The analyses attached to a run describe the model that was inspected when they
were computed, which is not always the winner. Each section names its model and
says so when it is not the one the card is about.

The card holds figures only, never a row of the data. What you type is kept
with the run in your browser and travels in its share link.

## Replaying one row

The what-if panel can **replay** its row through the inspected model: the
questions a decision tree asked, the count of a forest's trees, the five rows a
k-NN compared it to, the prediction a boosting builds round after round. The
replay walks the model itself, so its last step is the prediction shown, and its
questions are written in the units of the file. See
[replay a prediction](/docs/rejouer-une-prediction).

## Export, import, score

The model exports to JSON with its manifest: family, pipeline, versions. It
re-imports into a fresh session and scores a CSV. A frozen multiclass decision
rule travels with the export, and the scored CSV then carries two extra columns
— see [the formats page](/docs/formats). The five named import refusals are on
the [refusals page](/docs/refus).

Since format 5 the export also carries a **production reference**: shares and
counts describing the columns and the model's answers, never a row. Every batch
scored afterwards, by the live run or by the re-imported file, gets a
**production check**: one verdict (stable, watch, retrain) from three signals,
the columns, the answers, and the performance when the file carries labels. A
drift counts only above its own noise ceiling, and only a measured drop says
« retrain ». See [score a batch](/docs/scorer-un-lot).

A scored file with no label can leave as a **submission file** for a
competition: an identifier and a prediction under the names you give, every row
kept in its order. The measured model predicts by default; the same family
fitted again on every labelled row is offered, and announced as a model nobody
measured. See [score a batch](/docs/scorer-un-lot).

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

---
slug: limites
kind: explanation
order: 1
title: What LabML does not do, and why
summary: The features set aside, the ones dropped after measurement, and the predictions measurement refuted.
---

A project that names its limits reads as a serious one. A project that names
none reads as one that never looked for them.

This page is not written from memory. It is extracted from the repository's
engineering log (`PLAN.md`), where every wave records what it deliberately
refused to do — because elegant renunciations are easy to remember and
embarrassing ones are not.

## Three kinds of limit

They are not equivalent, and mixing them would be dishonest:

1. **A design choice** — it was feasible, and doing it would have degraded
   something more important.
2. **A measured drop** — it was built or costed, and the measurement said no.
   Stronger than a choice: it was not merely assumed.
3. **A refuted prediction** — the plan asserted one thing, measurement said
   another, and measurement won.

## Set aside by choice

| Set aside                                                         | Why                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An AutoML « we handle everything » mode                           | The exact opposite of a lab that shows its decisions                                                                                                                                                                                                                                                                                                  |
| A tenth model family                                              | Nine is plenty; a tenth improves neither honesty nor understanding                                                                                                                                                                                                                                                                                    |
| Tabular deep learning                                             | High cost, no gain at this scale, and no longer hand-written                                                                                                                                                                                                                                                                                          |
| A spreadsheet-style cell editor                                   | Hand edits break reproducibility — the recipe is the only record                                                                                                                                                                                                                                                                                      |
| Fuzzy deduplication                                               | Guaranteed false positives on names and addresses: silently merging two real people                                                                                                                                                                                                                                                                   |
| Model-based imputation                                            | Opaque, and it fabricates plausible values — refused twice, in V39 and V40                                                                                                                                                                                                                                                                            |
| Caching models across runs                                        | The cache key would be the whole configuration plus the data; a stale hit is a wrong leaderboard with no warning                                                                                                                                                                                                                                      |
| Guessing a file's locale                                          | The browser has no relationship to the file dropped into it                                                                                                                                                                                                                                                                                           |
| Making the absence indicator mandatory                            | It would add columns to every existing recipe: imposing is not announcing                                                                                                                                                                                                                                                                             |
| Translating the changelog and prerendering the French docs        | The changelog is an engineering log, not editorial content; without per-language routes, hreflang alternates would lie                                                                                                                                                                                                                                |
| Catching async errors and shipping crash reports                  | React boundaries cannot see callbacks or event handlers — claiming otherwise would be false; and nothing leaves the browser, telemetry included                                                                                                                                                                                                       |
| A daily Dependabot and `npm audit fix --force`                    | A daily cadence drowns the signal; `--force` moves majors without reading the break. The remaining advisories sit in build tooling, and we say so instead of hiding it                                                                                                                                                                                |
| Picking multiclass thresholds automatically                       | The lab shows its decisions instead of making them for you; and abstention is neither uncertainty calibration nor a conformal guarantee (that guarantee exists on its own panel, as prediction sets)                                                                                                                                                  |
| A run id in every worker message                                  | The worker answers in the order it is written to, so the training status is enough to recognise a stale answer. The id becomes necessary the day requests can overlap                                                                                                                                                                                 |
| A « rare class » warning in the interface                         | A one-row class stays in training, and a target where every class has one row is refused by name; a banner would flag a problem the split already handles                                                                                                                                                                                             |
| Splitting the ML Lab store into independent slices                | Every action shares one worker: slicing would have moved code without separating anything                                                                                                                                                                                                                                                             |
| Correcting a score for the runs it was compared with              | The inflation depends on how close the runs really are (0.2 to 0.8 times the split-to-split noise at 5 runs across the demos), and the lab cannot know that. The test-set ledger counts and warns; the score stays the one measured                                                                                                                   |
| Fingerprinting a file's content for the ledger                    | The ledger recognises a file by its name and shape. Two files sharing both would share a count; hashing every file on every load was not worth that rare case                                                                                                                                                                                         |
| Counting a tuning or an analysis in the ledger                    | They read the test set without choosing between runs; the ledger counts what a comparison between runs can inflate                                                                                                                                                                                                                                    |
| Saying « retrain » from a drift alone                             | A drift says the inputs or the answers moved, not that the model is wrong more often: on the mpg demo the batch that moved furthest had a lower error. Without labels the production check stops at « watch »                                                                                                                                         |
| Weighting a drift by the importance of its column                 | The export does not carry importances, and a column the model barely uses can still be the first sign that the population changed. Every column of the model is read the same way                                                                                                                                                                     |
| A history of the batches checked                                  | Each check reads one batch against the reference. Following a trend across batches needs a store of past checks, which nothing has asked for yet                                                                                                                                                                                                      |
| Changing how the PSI is computed                                  | The bins, the smoothing of empty bins and the formula are the ones everyone uses, so a PSI read here compares with one read elsewhere. What changed in V62 is what the number is compared to: its own noise ceiling                                                                                                                                   |
| A verdict on a shift of the missing rate                          | It is shown beside each column and left to the reader: a column going from 3 % to 0 % missing is a fact about the export, not a distribution to test                                                                                                                                                                                                  |
| Hand-written rules in a data contract                             | A contract freezes what the lab knows how to find: seven rules, the readings, the shares. Custom bounds and expressions are a language of their own, with its parser, its errors and its tests, and nothing has asked for it yet                                                                                                                      |
| Checking a contract from the ML Lab's scoring panel               | A file is checked in the Data Studio, where it already leaves for the lab. The model export keeps its own reference for the batch it scores (V61)                                                                                                                                                                                                     |
| A contract that blocks                                            | It reports and stops. A broken contract still loads, cleans and trains: the decision stays with whoever reads the clauses                                                                                                                                                                                                                             |
| The same figures in Python as in the lab                          | The exported script carries the rows of each split and the preprocessing exactly, and translates the models: the lab's estimators are written by hand. Measured on 30 runs, three families agree to the last digit and the others differ by up to several test rows on one split. The script prints both figures and the gap instead of promising one |
| A notebook, an environment file or a project as the Python export | One readable `.py` file to put where you like. A notebook format, pinned versions and a folder layout are choices that belong to whoever runs it                                                                                                                                                                                                      |
| A generative chat backed by a remote API (V12)                    | Postponed by product decision (confirmed 09/10/2026). Today's chat runs entirely in the browser; a remote API would send out the question and the column schema, never the data, and would require a consent screen                                                                                                                                   |

## Dropped after measurement

**The typed-array pipeline rewrite** (V25). It was planned. Then it was
measured: the pipeline was never the bottleneck.

**Two samples and a vote for the language model** (V30). Both tie-break
criteria died alongside constrained decoding: that decoding guarantees every
candidate validates, so « keep the one that validates » no longer discriminates.

**A language model four times larger** (V30). 1.43 GB, and it measures
**worse**: 40 right against 42, and 12 wrong against 7. It reads the hard
questions better and the easy ones worse. « Bigger » is not a direction of
improvement here; it is a trade whose sign has to be measured.

**CLIP for vision** (~190 MB, V31). The defect targeted — a classifier naming a
person — is covered for 0 MB by an honest refusal. CLIP would answer a
**different** question, and the bench cannot arbitrate it.

**A better object detector** (YOLOX-S, ~35 MB, V31). This one the bench does
arbitrate: the current detector's two misses are inert — both images are
already named correctly.

**A field-by-field validator for share links** (V48). Planned. Measured on
three real links with every field deleted, nulled or retyped: the links the
decoder accepted crashed the page on 99 distinct paths. A validator that size
would drift with every new analysis; a guard at render time covers them all,
and a test replays the measurement on every run.

**TypeScript 7** (V52.3). Deferred, not dropped. The new compiler, rewritten
in Go, checks the whole project with not a single error, and about seven times
faster than TypeScript 6. But the tool that runs the lint does not accept
that version yet, and the lint is part of the CI gate. A check is not removed
to make an upgrade fit: the migration waits for the tool to support it, and on
our side it will then be a version bump.

**Calibrating prediction sets on the validation split** (V57). It was the
plan: the validation rows are held out, and the multiclass decision panel
already tunes on them. Measured over 40 seeds, classification held its
targets. Regression did not for the model the leaderboard crowns: on the mpg
demo the winner covered 77.4 % for a target of 80, 88.7 % for 90 and 93.6 %
for 95, while the other families sat on target. Choosing the winner by
validation error is choosing the family whose validation residuals are
smallest. The threshold is calibrated on one half of the test split and
measured on the other instead, both ways: 79.8, 90.2 and 95.2 %.

## Predictions measurement refuted

This is the most useful category, and the most uncomfortable.

- The plan suspected the vision **crop** of squashing photos. The code did not
  squash them; and a full-frame squash scores exactly the same.
- The plan announced « you will get 0.821 » for the tutorial. The real figure
  is **0.792**.
- The plan wrote 18.6 MB for the three vision models. They weigh **18.5**, and
  a test is what flagged it.
- The order of the chat's two interpreters was inverted (V27.1), and
  measurement said so.

## A descope is not an abandonment

Class weighting was set aside by name in V16 — the cost-priced threshold gave
the same control at decision time. It was **delivered in V36**, with two
mechanisms named per family.

That is what separates « not done » from « forgotten »: a written renunciation
stays visible, and can become work again.

## Where to go next

- The [tutorial](/docs/premier-modele) if you have not trained a model yet.
- The [refusals table](/docs/refus) for what the app refuses case by case.
- The [method choices](/docs/methode) for the why behind the decisions that were taken.

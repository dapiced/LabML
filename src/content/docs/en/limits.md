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

| Set aside                               | Why                                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| An AutoML « we handle everything » mode | The exact opposite of a lab that shows its decisions                                                             |
| A tenth model family                    | Nine is plenty; a tenth improves neither honesty nor understanding                                               |
| Tabular deep learning                   | High cost, no gain at this scale, and no longer hand-written                                                     |
| A spreadsheet-style cell editor         | Hand edits break reproducibility — the recipe is the only record                                                 |
| Fuzzy deduplication                     | Guaranteed false positives on names and addresses: silently merging two real people                              |
| Model-based imputation                  | Opaque, and it fabricates plausible values — refused twice, in V39 and V40                                       |
| Caching models across runs              | The cache key would be the whole configuration plus the data; a stale hit is a wrong leaderboard with no warning |
| Guessing a file's locale                | The browser has no relationship to the file dropped into it                                                      |
| Making the absence indicator mandatory  | It would add columns to every existing recipe: imposing is not announcing                                        |

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

# V48: a damaged share link ends on a refusal, never on a crash

## Why

The post-V46 audit found that `isRenderable` checked `insights` was an object
and `RunView` then called `insights.importance.slice`: a link carrying
`insights: {}` passed the gate and crashed the page. The plan row proposed
validating that field and a few others.

## Measure first

Three real share links were captured from the running app and decoded:

| Link    | Run                 | Analyses carried                                 |
| ------- | ------------------- | ------------------------------------------------ |
| titanic | survived, binary    | uncertainty, threshold, segments                 |
| iris    | species, multiclass | uncertainty, threshold, k-NN tuning, exploration |
| mpg     | mpg, regression     | uncertainty, segments                            |

Every field (first two items of each array) was deleted, nulled, or replaced by
a string, a number, an object or an array, and each result was rendered
through the real `SharedRunPage`:

| Damaged links | Accepted by the decoder | Crashed the page | Distinct paths |
| ------------- | ----------------------- | ---------------- | -------------- |
| 3 948         | 3 660                   | 1 020            | 99             |

The paths run from `insights.importance` to
`artifacts.exploration.clusters[].traits[].clusterMean`. A validator covering
them would be the largest file in the share module and would drift every time
a run learns to carry a new analysis.

## Decision

- The decoder keeps checking what every view reads first (V35).
- `SharedRunPage` wraps the run in a render guard. Any failure while drawing it
  shows the refusal page with its own explanation, and nothing from the run.
  Showing the readable half was rejected: a half-read run lets a damaged figure
  pass for a real one.
- The measurement becomes a permanent test over the committed links
  (`tests/share-links/`). Each field shape is damaged six ways once, in the
  first link that carries it. It fails on the code before this wave.

Cost: the test adds about 25 s to the unit suite (66 s to 90 s on four cores).
Sampling fewer shapes would have been faster and would have reopened the gap
the wave closes.

## Also in this wave

The five copies of the download helper become `src/lib/download.ts`. The
object URL is revoked after the click has been handled rather than in the same
tick, where some engines cancel the download without a word.

## What this wave deliberately does not do

Write a field-by-field schema for every artifact, render a partially readable
run, or guard event handlers: a click on a damaged run is not reachable because
the refusal replaces it first.

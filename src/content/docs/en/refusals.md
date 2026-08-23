---
slug: refus
kind: reference
order: 1
title: Every refusal, and what to do about it
summary: Each named refusal LabML can raise — what triggers it, what it means, and the gesture that unblocks it.
---

LabML would rather refuse than answer approximately. That is a choice, not a
breakdown — but a refusal you cannot decode reads as a bug. This page exists
for that.

**This list is not written from memory.** It is extracted from the source, and
a test re-extracts it on every run: a code thrown but absent from here fails the
build, and a code listed here that the app no longer throws fails too. It
cannot drift in silence.

## How to read a refusal

A refusal carries a lowercase, hyphenated name — `filter-not-numeric`,
`llm-part-missing`. Some carry a detail after a colon: `too-large:120000:15`
says how many rows and columns were seen.

Two audiences, and the distinction matters:

- **visitor** — the refusal is shown with its own message. There is a gesture
  to make, and it is described below.
- **internal** — an invariant of the code. You should never meet one; if you
  do, that is a bug report, not a decision the app made.

## ML Lab — training

| Refusal             | What triggers it                                                | What to do                                                  |
| ------------------- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| `no-features`       | Every column was excluded, or none is usable                    | Re-include at least one column in the columns panel         |
| `target-not-found`  | The target column is no longer in the file                      | Pick a target again                                         |
| `task-undetectable` | The target is neither continuous numeric nor usable categorical | Choose another column, or force its type in the Data Studio |
| `too-few-rows`      | Grouping without a target needs more rows than there are        | Load a larger file                                          |
| `too-few-points`    | The time series is too short for an honest forecast             | Extend the period, or aggregate less finely                 |
| `missing-columns`   | The file to score lacks columns the model expects               | Add the columns named in the message                        |

### The announced splits

| Refusal                      | What triggers it                                                       | What to do                                                      |
| ---------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| `split-column-not-found`     | The requested split column is not in the file                          | Pick it again                                                   |
| `split-column-not-dated`     | A chronological split was asked for on a column with no readable dates | Use a real date column, or fall back to the seeded random split |
| `split-column-not-groupable` | A group split was asked for on a column that forms no groups           | Use a column with repeated values                               |

## ML Lab — importing a model

Five named reasons instead of a single « invalid file »: each says at which
stage reading stopped.

| Refusal               | What triggers it                                                      | What to do                                |
| --------------------- | --------------------------------------------------------------------- | ----------------------------------------- |
| `invalid-json`        | The file is not JSON                                                  | Check it is the exported file, unmodified |
| `not-labml`           | It is JSON, but not a LabML export                                    | Export the model from a LabML run         |
| `unsupported-version` | Format older than re-import support                                   | Export the model again from a recent run  |
| `bad-manifest`        | The manifest is incomplete — this export cannot be trusted to predict | Export again; do not force it             |
| `unsupported-kind`    | Unknown model family in this export                                   | Export again from this version of LabML   |

## Data Studio

| Refusal                | What triggers it                                                   | What to do                                         |
| ---------------------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| `join-key-missing`     | The join key is absent from one of the two files                   | Choose a key present on both sides                 |
| `duckdb-no-worker`     | The SQL engine could not start                                     | The rest of the Data Studio works; reload to retry |
| `sql-unsupported-file` | The file dropped into the console is neither CSV, Parquet nor JSON | Convert it to one of those three                   |

## Data assistant

| Refusal              | What triggers it                                                  | What to do                                         |
| -------------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| `filter-not-numeric` | The condition compares a column to something that is not a number | Rephrase with a number, or aim at a numeric column |
| `unknown-column`     | The question names a column that does not exist                   | Check the spelling in the columns panel            |

The assistant also refuses **without a code**, through a badge: « the
deterministic interpreter did not understand » or « neither the deterministic
interpreter nor the local model understood ». That is the most frequent
refusal, and the most important one: it beats a wrong number.

## Local language model

The model is downloaded in parts and reassembled in the browser. Four distinct
ways that can go wrong, named separately because they call for different
gestures.

| Refusal            | What triggers it                               | What to do                                                                          |
| ------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `llm-part-missing` | A part was not served                          | Reload; if it persists, the deployment is incomplete                                |
| `llm-part-size`    | A part is not the size the manifest announced  | Clear the site cache and reload                                                     |
| `llm-short`        | The reassembled file is shorter than announced | Same: cache, then reload                                                            |
| `llm-overflow`     | The reassembled file is longer than announced  | Same                                                                                |
| `no-webgpu`        | The browser exposes no WebGPU                  | The deterministic interpreter stays available; it answers most questions on its own |

The last three do not merely fail: they refuse **before** executing bytes whose
integrity cannot be guaranteed.

## Vision

Vision refuses without an error code, through a displayed verdict:

- **no class for a person** — both detectors agree there is a person in the
  frame, and ImageNet-1k has no class for a human being. The label stays
  visible, but it is not an answer.
- **too unsure to name** — the top class falls below the confidence floor. The
  five candidates stay listed, to be read as a shortlist.

## The internal refusals

These exist, but a visitor should never see one: they are invariants checked
during execution. If one appears, it is a bug.

`model-not-found`, `no-references`, `no-model`, `no-run`, `no-join`,
`no-data`, `no-manifest`, `not-ready`, `canvas-2d`, `grammar-too-long`,
`grammar-atom-long`, `grammar-option-long`, `grammar-too-many-options`.

## Guards that are not refusals

Two signals look like refusals and are not: `not-parallelisable` and
`not-serialisable`. When a model family cannot be trained in a helper worker,
it is simply trained sequentially in the main one. The result is identical,
only slower — which is why nothing is displayed.

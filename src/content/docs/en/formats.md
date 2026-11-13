---
slug: formats
kind: reference
order: 5
title: Reference — file formats
summary: What LabML reads, what it writes, and the exact shape of the model manifest.
---

## What can come in

| Format               | Where               | Notes                                                 |
| -------------------- | ------------------- | ----------------------------------------------------- |
| CSV                  | everywhere          | delimiter detected by evidence; comma, semicolon, tab |
| TSV                  | everywhere          | a special case of the above                           |
| Excel (.xlsx)        | ML Lab, Data Studio | first sheet, first row as header                      |
| Parquet              | SQL console         | read by DuckDB                                        |
| JSON                 | SQL console         | array of objects                                      |
| LabML model (.json)  | ML Lab              | an export, re-imported — see below                    |
| LabML recipe (.json) | Data Studio         | an exported recipe, replayed                          |
| Image                | vision              | JPEG, PNG, WebP — whatever the browser decodes        |

### Encoding and decimal separator

Encoding is established **by trying**: UTF-8 in strict mode throws on cp1252
accents, so the fallback is a certainty. The decimal separator is decided **per
column**: a column is rewritten only when at least 90% of its values are
comma-decimal numbers **and** it would otherwise not be numeric at all. A text
column holding « screw, flat head » comes out untouched.

### Dates

ISO and day-first formats are read. `31/12/2025` and `31-12-2025` both work.
When a file is ambiguous, the ambiguity is announced rather than settled in
silence.

## What can come out

| Format         | Contents                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------ |
| CSV            | cleaned dataset, batch predictions, SQL result                                                   |
| Parquet        | SQL result, through `COPY … TO`                                                                  |
| JSON           | trained model with its manifest; cleaning recipe; reference profile; data contract               |
| HTML           | run report, self-contained and readable offline                                                  |
| HTML, Markdown | model card of a run: what it is for, built on, worth, and what was never checked                 |
| Python         | a run as a scikit-learn script: the rows of each split, the preprocessing, each model translated |

## The model manifest

A model export is JSON that re-imports into a fresh session. It carries the
family, its learned parameters, the full pipeline (encodings, scalings, the
TF-IDF vocabulary where relevant) and a manifest:

```json
{
  "app": "LabML",
  "formatVersion": 5,
  "model": "logistic",
  "task": "classification",
  "target": "survived",
  "seed": 42,
  "createdAt": 1759312800000,
  "sourceDataset": { "name": "titanic.csv", "rowCount": 891 },
  "classes": ["0", "1"],
  "testMetrics": { "accuracy": 0.792 },
  "testRows": 179,
  "pipeline": { "specs": [] },
  "featureNames": ["pclass", "sex", "age"],
  "parameters": {}
}
```

`app` and `formatVersion` are checked before anything else: JSON that is not a
LabML export is refused by name (`not-labml`), not by a crash. Versions 2 to 5
re-import; anything older or newer is refused by name
(`unsupported-version:N`). An incomplete manifest is refused (`bad-manifest`)
rather than completed by guesswork — an export that cannot be trusted to predict
must not predict.

`testMetrics` and `testRows` keep the test score of the run that produced the
export: the honest reference a future batch is compared against.

### The production reference

Since format 5 an export carries a `reference` key: what the columns and the
model's answers looked like when it was exported, so a later batch can be read
against them.

```json
{
  "reference": {
    "v": 1,
    "rows": 570,
    "columns": [
      {
        "kind": "numeric",
        "column": "age",
        "missingRatio": 0.2,
        "mean": 29.6,
        "edges": [14, 19, 22, 25, 28, 31, 36, 41, 50],
        "shares": [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]
      },
      { "kind": "categorical", "column": "sex", "missingRatio": 0, "shares": { "male": 0.65 } }
    ],
    "predictions": { "kind": "classes", "rows": 321, "shares": [0.62, 0.38] },
    "performance": { "rows": 178, "accuracy": 0.82 }
  }
}
```

It holds bin edges, shares and counts, and never a row. The columns are profiled
on the training rows; the answers are read on the rows the model was not fitted
on. A regression stores the bins of its predicted values, its mean squared error
and the spread of its squared errors.

A reference that is not complete is **set aside, not fatal**: the model loads
without it, the panel says the block could not be read, and a batch is then
checked on its labels alone. Exports of formats 2 to 4 carry none and load as
before.

### The multiclass decision policy

An export may carry an optional `decisionPolicy` key, one threshold per class in
the order of `classes`:

```json
{ "decisionPolicy": { "thresholds": [0.5, 0.4, 0.6] } }
```

It is accepted only when all four conditions hold: `formatVersion` is 4 or 5,
the task is a classification, `classes` has more than two entries, and `thresholds`
is an array of the same length whose every value is a finite number between 0
and 1. Otherwise the import is refused (`bad-manifest`) — a half-readable
decision rule is a wrong decision rule.

When an imported model carries that policy, scoring a batch adds two columns to
the output CSV: `policy_decision`, the elected class — **empty** when the rule
abstains — and `decision_status`, which reads `decided` or `abstained`. Without
a policy, neither column appears.

## The reference profile

A drift profile stores **bins and shares, never rows**. The profile of a payroll
file describes the shape of the salary distribution and nobody's salary — which
is what makes it safe to commit beside the code.

## The data contract

A contract is JSON exported from the Data Studio and read back by it:

```json
{
  "format": "labml-data-contract/1",
  "source": "cafe-sales.csv",
  "createdAt": "2026-11-13T15:00:00.000Z",
  "rowCount": 118,
  "columns": [
    {
      "name": "quantity",
      "type": "numeric",
      "reading": "number",
      "missingRatio": 0.017,
      "profile": {
        "kind": "numeric",
        "column": "quantity",
        "missingRatio": 0.017,
        "mean": 2.55,
        "edges": [1, 2, 3, 4],
        "shares": [0.22, 0.28, 0.25, 0.17, 0.08]
      }
    }
  ],
  "rules": [
    {
      "kind": "validity",
      "rule": "negativeAmount",
      "columns": ["quantity"],
      "bound": { "min": 0 },
      "failures": 0,
      "tested": 116
    }
  ]
}
```

`reading` is what the contract requires of a column; `type` is the type the lab
inferred, kept for the reader. `profile` is present where a distribution means
something: a numeric, categorical or boolean column. Each rule keeps how often
it failed at the reference, since a rule already failing there is not broken by
the same rate.

A file that is not a whole contract is **refused, not applied in part**: an
unknown format, a column with no reading, an unknown rule, a rule naming a
column the contract does not describe. A clause silently dropped would be a
check silently skipped.

## The limits

| Limit          | Value                  | Why                                                                                  |
| -------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| Memory budget  | rows × columns, capped | reading stops and says so (`too-large`) instead of killing the tab, in every section |
| Served file    | 25 MiB                 | Cloudflare Pages hard limit; the language model is split to respect it               |
| Target classes | at most 20             | beyond that the task is no longer a usable classification                            |

## Where to go next

- [Score a new batch](/docs/scorer-un-lot) — the input format most often in question.
- The [refusals table](/docs/refus) if a file was refused by name.

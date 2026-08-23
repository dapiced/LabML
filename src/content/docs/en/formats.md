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

| Format  | Contents                                                            |
| ------- | ------------------------------------------------------------------- |
| CSV     | cleaned dataset, batch predictions, SQL result                      |
| Parquet | SQL result, through `COPY … TO`                                     |
| JSON    | trained model with its manifest; cleaning recipe; reference profile |
| HTML    | run report, self-contained and readable offline                     |

## The model manifest

A model export is JSON that re-imports into a fresh session. It carries the
family, its learned parameters, the full pipeline (encodings, scalings, the
TF-IDF vocabulary where relevant) and a manifest:

```json
{
  "labml": true,
  "version": 3,
  "kind": "logistic",
  "task": "binary",
  "features": ["pclass", "sex", "age"],
  "target": "survived",
  "seed": 42
}
```

`labml` and `version` are checked before anything else: JSON that is not a LabML
export is refused by name (`not-labml`), not by a crash. An incomplete manifest
is refused (`bad-manifest`) rather than completed by guesswork — an export that
cannot be trusted to predict must not predict.

## The reference profile

A drift profile stores **bins and shares, never rows**. The profile of a payroll
file describes the shape of the salary distribution and nobody's salary — which
is what makes it safe to commit beside the code.

## The limits

| Limit          | Value                  | Why                                                                    |
| -------------- | ---------------------- | ---------------------------------------------------------------------- |
| Memory budget  | rows × columns, capped | reading stops and says so (`too-large`) instead of killing the tab     |
| Served file    | 25 MiB                 | Cloudflare Pages hard limit; the language model is split to respect it |
| Target classes | at most 20             | beyond that the task is no longer a usable classification              |

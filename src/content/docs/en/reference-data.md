---
slug: reference-data
kind: reference
order: 3
title: Reference — Data Studio
summary: Quality score, validity rules, per-column recipe, join, drift, anomalies and the SQL console.
---

:::try /data | Open the Data Studio

## Quality score

A score broken into parts, each with its weight and what it actually cost. The
weights sum to **105, not 100**: validity brought its own 5 points rather than
taking them from the others, because redistributing would have quietly changed
what every previously published score meant.

## Validity rules

A value can be present, correctly typed, and still impossible. Five named
rules: age outside 0–120, a date in the future, a percentage outside 0–100, a
negative amount, a malformed postcode.

They obey two laws: they fire **on evidence, never on a column's name** — a
column called `age` holding 20,000 is a duration in days, so the rule first
checks that most of the column is plausible — and they **report without ever
repairing**.

## Cross-column consistency

Every cell fine, the **row** impossible: an end date before its start, a total
that is not quantity × price. Computed in memory, not through DuckDB: routing a
universally applicable check through an optional 18–22 MB download would have
made it conditional.

## Recipe

An ordered list of **per-column** steps, with the file-wide settings demoted to
defaults a column may override. A column with no entry behaves exactly as
before: that is what keeps every previously exported recipe valid.

Missing-value strategies: median, mean, most-frequent, a constant used
verbatim, or a « MISSING » category.

**Imputing without marking destroys information.** A blank is rarely blank at
random, and the fact of the blank is frequently predictive. Every column may add
a `<column>_absent` indicator, and **every indicator is written before any blank
is filled**. When a strategy cannot be honoured, the blanks are **left blank**
rather than filled with something invented. Columns filled without marking are
announced by name.

## Before / after diff

Which rows, which columns, which values changed. The hard part: a recipe drops
rows and adds columns, so `applyRecipe` returns which **source** row each
surviving row came from — without it the diff would pair row 7 with a different
row 7.

## Join

Left join on a key, with its statistics: match rate, orphan rows, duplicate
keys, columns added. Exact comparison after trimming edge whitespace.

## Drift

Two files compared: schema, per-column PSI over quantile bins, categories
appeared or gone, severities. A **replayable reference profile** stores bins and
shares — never rows — which is what makes it safe to commit beside the code.

## Anomalies

Hand-written, seeded isolation forest: 100 trees, subsample 256, exact c(n).
Replayable from the recipe.

## SQL console

DuckDB-Wasm, MIT, self-hosted, single-threaded (no COOP/COEP headers). Pinned to
**1.28.0** for a measured reason: from 1.29 its binaries exceed Cloudflare's
25 MiB per-file limit.

Queries the active dataset plus any CSV, Parquet or JSON attached to the
session. Results export to CSV or move to the ML Lab in one click. **Parquet**
export through `COPY … TO`.

---
slug: reference-data
kind: reference
order: 3
title: Reference — Data Studio
summary: Quality score, validity rules, per-column recipe, join, drift, anomalies and the SQL console.
---

:::try /data | Open the Data Studio

## Reading the file

The Studio reads a file with the same reader as the ML Lab: encoding settled by
decoding, delimiter and decimal separator detected per column, malformed rows
counted. The same memory budget applies, rows × columns capped at 20 million
cells; past it reading stops at that row and the page says where
(`too-large`), instead of the tab dying.

A file loaded for a **drift check** or a **join** is read the same way,
decimals included. Comparing a French export against a normalised dataset would
otherwise report a drift that is nothing but a decimal comma.

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

A severity is given only to a PSI that is **above its noise ceiling**. Two
samples of the same data never fall into the same bins: over B bins their PSI
averages about (B − 1) × (1/n + 1/n_ref), 0.11 for ten bins and 100 rows against 500. The usual reading (under 0.1 stable, 0.1 to 0.25 moderate, above 0.25
strong) therefore calls a small file a drift.

| PSI            | Under its ceiling | Above its ceiling |
| -------------- | ----------------- | ----------------- |
| under 0.1      | stable            | stable            |
| 0.1 to 0.25    | inside the noise  | moderate drift    |
| 0.25 and above | inside the noise  | strong drift      |

The ceiling is the value a PSI stays under, 95 reports in 100, when the two
files are two draws of the same data at their real sizes. It is simulated with a
fixed seed, from the two files put together, and shown beside the PSI. Measured
on two halves of one file, where every alert is false: the fixed thresholds
flagged 95 to 100 % of reports on files of 120 and 400 rows, and still 21 to
52 % at 640 and 890 rows; the ceiling flags 0.5 to 9.5 %. Nothing changes for a
large file, whose ceiling is low.

## Data contract

The quality report asks whether a file looks clean. A **contract** asks whether
it is still the file that was agreed on: it freezes what a reference file looks
like, and the next file is read against it clause by clause.

The report cannot do this on its own, by design. Its rules decide whether they
apply: a column named `age` holding 20 000 is a duration, not a crowd of
impossible people. The price of that guard was measured: once a fifth of a
column is impossible, the rule stops applying and the report says nothing. On
the titanic demo, 134 ages of 999 are flagged; 178 are not.

| Clause         | What it requires                                  | When it does not hold |
| -------------- | ------------------------------------------------- | --------------------- |
| Column present | every column of the reference is there            | **broken**            |
| Reading        | values still read as numbers, dates or words      | **broken**            |
| Missing values | no measurably higher share than at the reference  | **broken**            |
| Rule           | a rule that applied at the reference still passes | **broken**            |
| Distribution   | the column has not moved beyond its noise ceiling | **warning**           |

Two rules, stated on the panel:

- **a fact is not an estimate.** A column that is gone, values that no longer
  read as numbers, an impossible value break a clause outright. A share of
  missing values and a distribution are estimates: they count only beyond their
  noise, at a level shared between the columns;
- **moving is not breaking.** A distribution that drifted is a warning.

A rule that was clean at the reference is broken by its first failure; a rule
that already failed there is broken only by a measurably higher rate. A column
the contract does not describe is noted, not broken.

The clause tests how values **read**, not the type the lab infers. The inferred
type (categorical or text, number or identifier) depends on how many distinct
values a file happens to hold: on two halves of one 118-row file it changed for
one column in every two checks.

Measured on two halves of one file, where nothing changed: no broken clause on
three demos out of five, 2 % of checks on titanic, and drift warnings on 0.5 to
7.5 %. The fifth demo holds one negative price, and the half that does not hold
it yields a contract the other half breaks: a true finding.

The contract holds names, bounds, shares and counts, never a row. Checking is
not cleaning: nothing is repaired, and nothing is blocked.

## Anomalies

Hand-written, seeded isolation forest: 100 trees, subsample 256, exact c(n).
Replayable from the recipe.

## SQL console

DuckDB-Wasm, MIT, self-hosted, single-threaded (no COOP/COEP headers). Pinned to
**1.28.0** for a measured reason: from 1.29 its binaries exceed Cloudflare's
25 MiB per-file limit.

Queries the active dataset plus any CSV, Parquet or JSON attached to the
session. A result exports to CSV or **Parquet**, or moves to the ML Lab, in one
click. All three are written by the engine through `COPY … TO` and carry every
row of the result, not the 200 the console paints; a NULL leaves as an empty
cell. See [hand a SQL result to the ML Lab](/docs/sql-vers-le-lab).

## Where to go next

- [Hand a SQL result to the ML Lab](/docs/sql-vers-le-lab) — this section's most useful gesture.
- The [ML Lab reference](/docs/reference-ml) for what happens next.

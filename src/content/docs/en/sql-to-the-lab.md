---
slug: sql-vers-le-lab
kind: how-to
order: 4
title: Hand a SQL result to the ML Lab
summary: Filter, join or aggregate in SQL, then train on the result — with no intermediate file.
---

## The gesture

1. Open the [Data Studio](/data) and load a file.
2. In the **SQL console**, write your query. The active dataset is queryable by
   name, and you can attach other files — CSV, Parquet or JSON.
3. Once the result is right, click **Send to the ML Lab**.

The result becomes the lab's active dataset. Nothing is written to disk on the
way.

:::try /data | Open the Data Studio

## When this is the right tool

- **Filter before training**: keep one region, one period, one segment.
- **Join** several files on a key, when the Data Studio's own join is not
  enough.
- **Aggregate**: go from one row per event to one row per customer, which is
  what most real ML problems need.

## What leaves the console

The console paints the first 200 rows so it stays responsive, and always states
how many rows the query returned. **The exports are the query, not the screen**:
the CSV, the Parquet file and the ML Lab handoff are written by the engine
itself, and carry every row.

- **A NULL stays a missing value.** It leaves as an empty cell, which the lab
  reads as missing. A numeric column with NULLs arrives as a number with gaps.
- **Each query has a file name of its own**, such as `query-3f2a91c4.csv`: a
  fingerprint of the query, never its text. The lab's test-set ledger knows a
  file by its name and shape, and two queries of the same shape must not share
  one count.
- **The lab's cell budget applies.** A result past 20 million cells (rows times
  columns) is refused before it is built, with the advice to aggregate or
  filter. It is the same budget a file is read under.

Until V69 the exports were built from the painted rows: a query returning 590
rows handed 200 to the lab, and a NULL arrived as the mark the console shows
for it, which turned a numeric column into text. Measured after the fix: the
590 rows arrive, and a plain `SELECT *` over each of the lab's six demos gives
back the same rows, the same columns and the same inferred types as the file
itself.

## The cost, announced

The SQL engine is an 18–22 MB download, **optional**. Until you open it, it is
not downloaded. It is single-threaded: LabML does not serve the headers that
would unlock multi-threading.

That is also why cross-column consistency checks do **not** go through SQL:
they have to work for everyone, including people who never open the console.

## Where to go next

- The [tutorial](/docs/premier-modele) to train on the result.
- The [Data Studio reference](/docs/reference-data) for the accepted formats.

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

## The cost, announced

The SQL engine is an 18–22 MB download, **optional**. Until you open it, it is
not downloaded. It is single-threaded: LabML does not serve the headers that
would unlock multi-threading.

That is also why cross-column consistency checks do **not** go through SQL:
they have to work for everyone, including people who never open the console.

## Where to go next

- The [tutorial](/docs/premier-modele) to train on the result.
- The [Data Studio reference](/docs/reference-data) for the accepted formats.

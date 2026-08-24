---
slug: comparer-deux-runs
kind: how-to
order: 2
title: Compare two runs
summary: You changed something and want to know what it cost or gained. Here is how to attribute the gap.
---

## The gesture

1. Train once. The run is saved to the history at the bottom of the ML Lab.
2. Change **one single thing** — remove a column, change the split, enable
   class weighting.
3. Train again.
4. In the history, select both runs and open **Compare**.

Up to six runs can be compared at once.

## What the page gives you

- **The configuration** on both sides, with the differences highlighted.
- **The features** added and removed, named.
- **The per-model leaderboard**: each family, its score on both sides, and the
  gap.
- **Cross-run uncertainty**: does the gap survive resampling, or does it sit
  inside the noise?

That last line is the one that counts. A +0.01 gap over 178 test rows is not a
gain — it is a draw.

## Why change one thing only

Because the seed is fixed, everything left unchanged **stays identical**. If
you change one variable, the gap is attributable to it.

If you change three, the page will faithfully show you a gap you will not be
able to apportion. LabML cannot untangle that for you.

## Where to go next

- [Read a learning curve](/docs/lire-une-courbe) if the question is « would more data help? ».
- [The method choices](/docs/methode) on why uncertainty is shown rather than hidden.

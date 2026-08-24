---
slug: premier-modele
kind: tutorial
order: 1
title: Your first model in 10 minutes
summary: From an empty page to a trained model, honestly evaluated and readable — with nothing sent anywhere.
---

This tutorial has you train a real model on a real dataset, then **read its
result without being lied to**. It offers no choices: follow it as written and
you will get exactly the numbers printed here. Compare them — if one differs,
LabML has a problem, not you.

Allow ten minutes. Everything happens in your browser: no data leaves, no
account is asked for.

## Load the dataset

Open the ML Lab and click the **titanic.csv** demo. This link does it for you:

:::try /ml?demo=titanic | Open the ML Lab with titanic.csv loaded

Under the file name, LabML reports what it read:

> 891 rows · 15 columns

The file was read **in place**. Open your browser's Network tab and reload:
you will see no request carrying your data.

## Choose the column to predict

Under **Column to predict**, choose `survived`.

Three things appear at once, and each is worth a look.

First, the kind of task: **Binary classification**. LabML worked it out from
the column — two distinct values, so two classes.

Then a warning:

> Target leakage: `alive` almost perfectly mirrors the target — excluded
> automatically.

This is the detail that separates a model from an illusion. The `alive` column
says "yes" exactly when `survived` is 1: a model that sees it scores almost
perfectly and has **learned nothing**. LabML drops it and tells you, rather
than letting you publish 99%.

Finally, a class-balance warning: the largest class holds 62% of the training
rows. Keep it in mind — it matters at the end.

## Train

Click **Train**. Several model families are trained in parallel, in workers, on
your machine.

Below the leaderboard, LabML states the protocol:

> seed 42 · 570 train rows · 143 validation rows · 178 test rows ·
> 30 features after encoding

**Three splits, not two**, and that is deliberate. Training is for learning;
validation is for picking the winner; the test set is touched exactly once, at
the end. Seed 42 is fixed: run it again and you get the same numbers.

## Read the leaderboard

Here is what you should see, in this order:

| #   | Model               | Accuracy (val) | Test      |
| --- | ------------------- | -------------- | --------- |
| 1   | k-nearest neighbors | **0.818**      | 0.792     |
| 2   | Ensemble (top 3)    | 0.790          | 0.815     |
| 3   | Gradient boosting   | 0.790          | 0.820     |
| 4   | Logistic regression | 0.790          | 0.820     |
| 5   | Decision tree       | 0.790          | **0.831** |
| 9   | Naive baseline      | 0.615          | 0.618     |

Stop on this table for a moment, because it holds the most important point of
the tutorial.

## The winner is not the best — and that is normal

The elected champion is **k-nearest neighbors**, at 0.818 on validation. But on
the test set it scores **0.792** — and the decision tree scores 0.831, better
than it.

This is not a bug. It is what LabML tells you under the leaderboard:

> k-nearest neighbors was selected on validation at 0.818 and scores 0.792 on
> the untouched test set (-0.026).

Picking the best of several models **on a split makes that split optimistic**:
keep looking at validation to elect a winner and you end up electing the one
that got lucky on it. The only number still honest is the one from the third
split, never used to choose.

Plenty of tools would show you 0.831 in large type. The number to keep here is
**0.792**, and the -0.026 gap is the price of selection, displayed rather than
hidden.

## Read the result in plain language

Below the leaderboard, the **plain read** translates:

> k-nearest neighbors gets 79.2% of the 178 held-out test rows right. That is
> 17.4 points above the naive baseline (61.8%), so the model has learned real
> signal. It catches 72.1% of the actual "1" cases. The most decisive columns
> are: sibsp, pclass, sex.

The naive baseline always answers the majority class. At 61.8%, it is the
yardstick: a model that does not beat it has learned nothing, whatever its
absolute score. Those 17.4 points are the only evidence that training was worth
anything.

Remember the class-balance warning: with 62% of rows in one class, accuracy
flatters. That is why the plain read also quotes recall — 72.1% of the real
positive cases actually caught.

## What you just did

You loaded a locally read file, dropped an automatically flagged target leak,
trained several families over three seeded splits, and read a score from a test
set never used to choose. That is the full protocol, not a simplified demo.

None of it left your browser.

## Where to go next

Click any leaderboard row to inspect a model other than the champion. Each
panel below the leaderboard answers one precise question: how solid the numbers
are, whether the ranking is real, where the decision threshold should sit, and
where the model fails.

- [Score a new batch](/docs/scorer-un-lot) — the production gesture.
- [Read a learning curve](/docs/lire-une-courbe) — would more data help?
- [The method choices](/docs/methode) — why the baseline, the intervals and seed 42.

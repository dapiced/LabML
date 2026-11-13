---
slug: chercher-un-contrefactuel
kind: how-to
order: 7
title: Find what would change a prediction
summary: For one row, the smallest change of its values that makes the model answer another class, and how far to trust it.
---

## The gesture

1. Train a classification model and click a family in the leaderboard to inspect it.
2. In **What if…**, set the values of one row.
3. Tick **locked** on the columns that cannot change for this case: an age, a sex, a
   past event. The lab does not guess them.
4. Click **What would have to change?**

:::try /ml?demo=titanic&target=survived | Train titanic and look for a change

Each answer is a change you could have typed yourself, « `pclass`: 3 → 1 », with a
button to load it into the form and see the prediction move.

## How the search works

It is a search a reader can follow, not an optimisation:

1. **one column at a time.** Every value the training rows hold for that column is
   tried in place of the row's own; the column keeps the nearest one that changes
   the answer;
2. **two columns together**, only when no single column changes the answer;
3. **never three.** A change of five columns is no longer an explanation.

Only values some training row holds are tried: no number outside the file, no
category that does not exist, nothing interpolated. Free-text columns are never
edited. With three classes or more you can ask for one class in particular.

When nothing changes the answer within these limits, the panel says so and says
how many rows it tried. That is an answer too: for this model, this row is far
from any other class.

## What the measure showed

On the classification demos, 60 test rows per run, seven families:

| Demo    | One column is enough | Two are needed | Nothing found |
| ------- | -------------------- | -------------- | ------------- |
| titanic | 63 to 98 % of rows   | 2 to 30 %      | 0 to 9 %      |
| fraud   | 28 to 100 %          | 0 to 69 %      | 0 to 9 %      |
| iris    | 96 to 100 %          | 0 to 4 %       | none          |
| reviews | 0 to 100 %           | 0 to 38 %      | 0 to 100 %    |

On reviews most models find nothing: the answer is in the text, which the search
does not edit.

Two findings shaped the panel.

## Reading one: does the changed row still exist?

A row built from values that each exist can still look like no row at all. The
first search kept the nearest change whatever it was, and **8 to 60 % of its
answers were farther from every training row than training rows usually are from
each other**: the model was answering where it had seen nothing.

So the search now prefers, for each column, the nearest change that stays inside
the cloud of training rows, and flags the ones that do not. On iris about half
the answers stay flagged whatever is tried: its four columns move together, and
changing one alone leaves the cloud.

The lab also does not know that two columns say the same thing. On titanic,
`sex`, `who` and `adult_male` describe one fact; changing `adult_male` alone
describes a passenger who cannot exist. Lock the columns that duplicate another,
or better, leave them out of the features.

## Reading two: do the other models follow?

The smallest change that flips a model lands just across its boundary. Measured:
of the other trained models that agreed on the row, **only 14 to 54 % answered the
new class** for the same change.

So each answer says how many of the other models follow. A change most of them
follow says something about the data. A change only this model follows is an edge
of this model.

## A counterfactual speaks of the model, not of the world

« The model would answer yes with an income of 52 » is not « earn 52 and you will
get yes ». The model learned which values go together in the file, not what
causes what. Use a counterfactual to understand and to challenge a model, not as
advice to the person the row describes.

## Where to go next

- [Replay a prediction](/docs/rejouer-une-prediction) to read the steps the model took.
- [The limits](/docs/limites) for what the search does not do.
- [The ML Lab reference](/docs/reference-ml) for the rest of the what-if panel.

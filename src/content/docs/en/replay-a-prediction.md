---
slug: rejouer-une-prediction
kind: how-to
order: 6
title: Replay a prediction step by step
summary: Open the model on one row and read what it did, the questions a tree asked, the rows a k-NN consulted, the rounds of a boosting.
---

## The gesture

1. Train a model and click a family in the leaderboard to inspect it.
2. In **What if…**, set the values of one row. The prediction updates.
3. Click **Replay it step by step**.

:::try /ml?demo=titanic&target=survived | Train titanic and replay a passenger

**Why this prediction?** (Shapley) says what weighed. The replay says what
happened: the steps the model took for this row, in the order it took them.
The two answer different questions and are worth reading together.

## What each family tells

| Family            | What the replay shows                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Decision tree     | each question asked of the row, how many training rows were asked the same, and the leaf it ends in: how many training rows share it and what they are |
| Random forest     | how many of its 40 trees answered each class, or the spread of their values                                                                            |
| k-NN              | the 5 training rows the row was compared to: their row number in your file, their distance, their target and their main columns                        |
| Gradient boosting | the prediction round after round, the rounds that moved it most, and the error on the validation rows as the rounds add up                             |

The other families have no steps to tell, and the panel says why: a linear or
logistic model is one weighted sum that the Shapley explanation already reads, a
network mixes every column at once, and the blend averages other models.

## The replay is the model

Nothing is approximated. A replay walks the structure the model itself predicts
with, and its last step is the prediction shown above it. This was measured
before the panel was built: on the six demos, five splits each, 2,560 test rows,
the replay gave the model's answer on every row for the four families.

The first measure found one gap: three rows of titanic where the forest and its
replay disagreed. On a tie between two classes the library keeps the first class
to reach the top count, in the order of the trees, not the smallest one. The
replay now does the same, and says when a vote is tied.

## Questions in the units of your file

A model sees encoded columns: a number standardized, a category spread over 0/1
columns. The replay translates what translates exactly:

- a number gets its unit back: `age < 9.5`, not `age < -1.42`;
- a 0/1 column becomes a question about the category: « sex is "male"? »;
- a word of a free-text column and a frequency rank are shown as the model sees
  them, under their encoded name. On the reviews demo, whose columns are text,
  nearly every question of the tree is of that kind.

## Reading the boosting

Every row starts at the same point (the share of the class in training, or the
mean), and each round adds a small correction. The panel gives the round by
which 90 % of the way was made, and tells up to three rounds in full: the
largest movers among those asking different questions, each with the number of
other rounds that asked this row exactly the same.

It also shows the error on the **validation rows** as the rounds add up. On the
demos the lowest validation error came well before the last round on 17 runs out
of 30, and on the energy demo the boosting never beat its starting point on
three splits out of five.

That looks like a reason to stop earlier, so it was measured (V67), on a quarter
of the rows kept away from everything, ten splits per demo. Stopping at the
lowest point of the curve, against the 120 rounds the lab runs:

| Demo    | Accuracy or RMSE on the rows kept away | Log loss                  |
| ------- | -------------------------------------- | ------------------------- |
| titanic | +0.4 point (better 5, worse 4)         | better on 10 splits of 10 |
| fraud   | no change                              | slightly worse            |
| iris    | no change                              | slightly worse            |
| reviews | **4 points lower** (worse 6, better 2) | better on 10 splits of 10 |
| mpg     | no change                              | no change                 |
| energy  | RMSE 3.5 % lower (better 9, worse 1)   | the same measure          |

Fewer rounds give better probabilities, not better predictions: the classes
predicted are no more accurate, and on reviews they are less. The one gain is on
energy, where the boosting does no better than the mean and is never the family
the validation rows choose. So the lab keeps its 120 rounds. The curve says
where the error turned; it does not say that fewer rounds would predict better.
It is read on validation, never on the test set.

## Ties in a k-NN

When the next row is exactly as far as the last neighbour kept, another row
order or another library would have kept the other one, and the answer can
change with it. It is common where columns hold few distinct values: 17 % of the
test rows on titanic, 39 % on energy. The panel flags it on the row concerned.

## A trace is not a cause

The path of a tree says which questions were asked of this row. It does not say
that a column makes the answer: another tree, trained on another split, would
ask other questions and often agree on the prediction.

## Where to go next

- [Read a learning curve](/docs/lire-une-courbe) to see whether more rows would help.
- [The ML Lab reference](/docs/reference-ml) for what each family is.
- [The limits](/docs/limites) for what the replay does not do.

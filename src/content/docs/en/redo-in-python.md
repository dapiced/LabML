---
slug: refaire-en-python
kind: how-to
order: 5
title: Redo a run in Python
summary: You trained in the browser and want the same run in a notebook. Here is the script LabML writes, what it carries exactly, and what it only translates.
---

This assumes you have a finished run. If not, start with the
[tutorial](/docs/premier-modele).

## The gesture

1. Under the leaderboard, click **Python script (scikit-learn)**.
2. Put the script next to the file the run was made on.
3. Run it.

```bash
python labml-titanic.py --data titanic.csv
```

It needs pandas and scikit-learn. It prints one line per model: LabML's test
metric, its own, and the gap.

:::try /ml?demo=titanic&target=survived | Train titanic, then export the script

## What is carried exactly

- **The rows of each split.** The script holds the row numbers of the training,
  validation and test sets. Not a seed that should give the same split: the
  split itself.
- **The preprocessing.** One transformer per column, in LabML's order: a number
  is standardized on the values that are there, then a missing one becomes the
  median; a label becomes one column per category, or its rank when there are
  too many; free text goes through LabML's vocabulary.

Measured on six demos and five seeds each: the matrix the script encodes from
the training rows equals LabML's to within 2.9e-14.

## What is translated

The models. LabML's estimators are written by hand or come from ml.js; the
script uses the nearest scikit-learn estimator with LabML's settings. Each line
it prints says which case it is.

| Relation                                           | Families                                             | What was measured                                      |
| -------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| same algorithm                                     | baseline, linear regression, naive Bayes             | the same test metric on every run                      |
| same algorithm, equal distances broken differently | k-NN                                                 | the same metric on four demos out of six               |
| same family, another implementation                | logistic regression, tree, forest, boosting, network | a small gap on average, several test rows on one split |

So the script **does not promise LabML's figures**. It measures them again and
shows both. A gap is not an error of either side: it is what separates two
implementations of one idea. On a test set of 30 rows, one row is 3.3 points of
accuracy.

The whole record, family by family, is in `tests/golden/python-bridge.md`.

## What the script checks before running

It refuses a file that is not the one of the run: another number of rows or of
columns stops it with a message, since row numbers would then point at other
rows.

```bash
python labml-titanic.py --check
```

`--check` reads the run and prints what it holds, with no library installed.

## What is not redone

- The **ensemble** of a run: it is named as not redone.
- The hyperparameter search, the learning curve, the group audit, the
  production check: the script redoes the training and its evaluation.
- A run read from a **spreadsheet**: save the sheet as CSV first. The script
  says so when it starts.

The script holds column names, row numbers, settings and LabML's metrics. No
value of any row is in it: the data stays where it is.

## Where to go next

- [The formats](/docs/formats) for what LabML reads and writes.
- [The limits](/docs/limites) for what was left out, and why.

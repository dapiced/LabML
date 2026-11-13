# The Python bridge, measured

LabML exports a run as a scikit-learn script (V64). This file records how far the script's
figures sit from LabML's own, on the demos, and how the record was made. It is regenerated on
purpose, outside CI, like `sklearn-reference.json`.

```bash
LABML_BRIDGE_OUT=/tmp/bridge npx vitest run src/features/ml/train/python-bridge.bench.test.ts
```

```bash
python tests/golden/python-bridge.py /tmp/bridge public/datasets
```

Six demos, five seeds each, the default split (64 / 16 / 20). Measured with Python 3.13,
scikit-learn 1.9.1 and pandas 3.1.1.

## What is identical

- **The rows.** The script carries the indices of each split.
- **The encoding.** On the 30 runs, the matrix the script encodes from the training rows equals
  the one LabML encoded to within 2.9e-14, free text included.
- **Three families.** The baseline, the linear regression and the Gaussian naive Bayes gave the
  same test metric as LabML on every run.

## What is not

- **k-NN** is the same algorithm, and gave the same metric on four demos out of six. Where two
  neighbours sit at the same distance, each library breaks the tie its own way: `energy.csv`
  has a single feature column, and its RMSE moved by up to 1.32.
- **The other families are translations.** LabML's tree, forest, boosting, logistic regression
  and network are written by hand or come from ml.js. The gap is small on average and can
  reach several test rows on one split: on `iris.csv`, whose test set has 30 rows, one row is
  3.3 points of accuracy.

A gap is not an error of either side. It is what separates two implementations of one idea.

## The record

`Mean gap` and `Worst gap` are scikit-learn minus LabML, over the five seeds. Accuracy is a
share; RMSE is in the unit of the target.

| File                   | Model      | Relation   | Mean gap | Worst gap |
| ---------------------- | ---------- | ---------- | -------- | --------- |
| energy.csv (RMSE)      | baseline   | same       | -0.0000  | -0.0000   |
| energy.csv (RMSE)      | linear     | same       | -0.0000  | -0.0000   |
| energy.csv (RMSE)      | knn        | same-ties  | -0.2621  | -1.3214   |
| energy.csv (RMSE)      | tree       | translated | +0.0695  | +1.7035   |
| energy.csv (RMSE)      | forest     | translated | +0.7626  | +2.1553   |
| energy.csv (RMSE)      | gbdt       | translated | -0.6190  | -2.6113   |
| energy.csv (RMSE)      | mlp        | translated | -0.0064  | -0.6066   |
| fraud.csv (accuracy)   | baseline   | same       | +0.0000  | +0.0000   |
| fraud.csv (accuracy)   | logistic   | translated | -0.0047  | -0.0156   |
| fraud.csv (accuracy)   | knn        | same-ties  | +0.0000  | +0.0000   |
| fraud.csv (accuracy)   | naiveBayes | same       | +0.0000  | +0.0000   |
| fraud.csv (accuracy)   | tree       | translated | +0.0016  | +0.0156   |
| fraud.csv (accuracy)   | forest     | translated | +0.0078  | +0.0078   |
| fraud.csv (accuracy)   | gbdt       | translated | +0.0000  | +0.0000   |
| fraud.csv (accuracy)   | mlp        | translated | -0.0078  | -0.0156   |
| iris.csv (accuracy)    | baseline   | same       | +0.0000  | +0.0000   |
| iris.csv (accuracy)    | logistic   | translated | +0.0333  | +0.1000   |
| iris.csv (accuracy)    | knn        | same-ties  | +0.0000  | +0.0000   |
| iris.csv (accuracy)    | naiveBayes | same       | +0.0000  | +0.0000   |
| iris.csv (accuracy)    | tree       | translated | +0.0067  | +0.0333   |
| iris.csv (accuracy)    | forest     | translated | +0.0067  | +0.0333   |
| iris.csv (accuracy)    | gbdt       | translated | +0.0000  | -0.0333   |
| iris.csv (accuracy)    | mlp        | translated | -0.0600  | -0.1333   |
| mpg.csv (RMSE)         | baseline   | same       | +0.0000  | -0.0000   |
| mpg.csv (RMSE)         | linear     | same       | +0.0000  | -0.0000   |
| mpg.csv (RMSE)         | knn        | same-ties  | -0.0000  | -0.0000   |
| mpg.csv (RMSE)         | tree       | translated | -0.0255  | -0.3421   |
| mpg.csv (RMSE)         | forest     | translated | +0.0194  | +0.1310   |
| mpg.csv (RMSE)         | gbdt       | translated | -0.0368  | -0.1315   |
| mpg.csv (RMSE)         | mlp        | translated | +0.1487  | +0.3141   |
| reviews.csv (accuracy) | baseline   | same       | +0.0000  | +0.0000   |
| reviews.csv (accuracy) | logistic   | translated | -0.0292  | -0.1458   |
| reviews.csv (accuracy) | knn        | same-ties  | +0.0000  | +0.0000   |
| reviews.csv (accuracy) | naiveBayes | same       | +0.0000  | +0.0000   |
| reviews.csv (accuracy) | tree       | translated | +0.0000  | -0.0417   |
| reviews.csv (accuracy) | forest     | translated | -0.0125  | -0.0417   |
| reviews.csv (accuracy) | gbdt       | translated | +0.0083  | -0.0417   |
| reviews.csv (accuracy) | mlp        | translated | +0.0125  | +0.0833   |
| titanic.csv (accuracy) | baseline   | same       | +0.0000  | +0.0000   |
| titanic.csv (accuracy) | logistic   | translated | +0.0079  | +0.0225   |
| titanic.csv (accuracy) | knn        | same-ties  | -0.0011  | +0.0056   |
| titanic.csv (accuracy) | naiveBayes | same       | +0.0000  | +0.0000   |
| titanic.csv (accuracy) | tree       | translated | -0.0472  | -0.0674   |
| titanic.csv (accuracy) | forest     | translated | -0.0315  | -0.0449   |
| titanic.csv (accuracy) | gbdt       | translated | +0.0124  | +0.0393   |
| titanic.csv (accuracy) | mlp        | translated | +0.0315  | +0.0562   |

# scikit-learn golden references

`sklearn-reference.json` is the independent scientific reference for LabML's hand-written
metrics and its simplest compatible models. Vitest reads the committed fixture, so CI does not
install Python or scikit-learn.

Regenerate it only when intentionally reviewing these contracts:

```powershell
uv run --python 3.13 --with scikit-learn==1.7.2 python tests\golden\generate.py
git diff -- tests\golden\sklearn-reference.json
```

The generator uses the same stated assumptions as LabML where equivalence matters:

- ridge regression includes and regularizes the bias column;
- k-NN uses five uniformly weighted Euclidean neighbors;
- class labels are `0..k-1`;
- the conformal threshold is the `ceil((n+1)(1-alpha))`-th smallest score, absent when that rank
  exceeds `n`.

The `conformal` block needs numpy only: split conformal prediction is a quantile, and the
generator computes it two ways (by rank, and as numpy's inverted-CDF quantile) and requires them
to agree before writing.

The random forest, decision-tree, GBDT, MLP and logistic implementations are intentionally not
compared to scikit-learn predictions. Their algorithms or defaults differ, so numerical equality
would be a false contract rather than a useful regression test.

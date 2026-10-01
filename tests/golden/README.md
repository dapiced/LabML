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
- class labels are `0..k-1`.

The random forest, decision-tree, GBDT, MLP and logistic implementations are intentionally not
compared to scikit-learn predictions. Their algorithms or defaults differ, so numerical equality
would be a false contract rather than a useful regression test.

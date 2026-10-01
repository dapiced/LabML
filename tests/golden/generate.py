"""Generate committed scikit-learn references for LabML.

This script is deliberately not part of CI: CI consumes the JSON fixture and
therefore does not need Python or scikit-learn. Run it only when intentionally
reviewing the scientific reference values.
"""

from __future__ import annotations

import json
import platform
from pathlib import Path

import numpy as np
import sklearn
from sklearn.linear_model import Ridge
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    log_loss,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
)
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor

OUTPUT = Path(__file__).with_name("sklearn-reference.json")


def floats(values: np.ndarray | list[float]) -> list[float]:
    return np.asarray(values, dtype=float).tolist()


def metrics() -> dict[str, object]:
    classification_true = [0, 1, 2, 0, 1, 2, 0, 1, 2, 2]
    classification_pred = [0, 2, 2, 0, 1, 1, 2, 1, 0, 2]
    probabilities = [
        [0.80, 0.15, 0.05],
        [0.10, 0.35, 0.55],
        [0.05, 0.10, 0.85],
        [0.65, 0.25, 0.10],
        [0.15, 0.70, 0.15],
        [0.10, 0.55, 0.35],
        [0.20, 0.25, 0.55],
        [0.05, 0.90, 0.05],
        [0.45, 0.20, 0.35],
        [0.05, 0.15, 0.80],
    ]
    binary_true = [0, 0, 1, 1, 0, 1, 0, 1]
    binary_scores = [0.10, 0.40, 0.40, 0.80, 0.25, 0.65, 0.25, 0.65]
    regression_true = [3.0, -0.5, 2.0, 7.0, 4.5, 1.25]
    regression_pred = [2.5, 0.0, 2.0, 8.0, 3.75, 1.5]

    return {
        "classification": {
            "yTrue": classification_true,
            "yPred": classification_pred,
            "probabilities": probabilities,
            "accuracy": accuracy_score(classification_true, classification_pred),
            "precision": precision_score(
                classification_true, classification_pred, average="macro", zero_division=0
            ),
            "recall": recall_score(
                classification_true, classification_pred, average="macro", zero_division=0
            ),
            "f1": f1_score(
                classification_true, classification_pred, average="macro", zero_division=0
            ),
            "logLoss": log_loss(
                classification_true, probabilities, labels=[0, 1, 2]
            ),
        },
        "binaryRoc": {
            "yTrue": binary_true,
            "scores": binary_scores,
            "rocAuc": roc_auc_score(binary_true, binary_scores),
        },
        "regression": {
            "yTrue": regression_true,
            "yPred": regression_pred,
            "rmse": mean_squared_error(
                regression_true, regression_pred
            )
            ** 0.5,
            "mae": mean_absolute_error(regression_true, regression_pred),
            "r2": r2_score(regression_true, regression_pred),
        },
    }


def models() -> dict[str, object]:
    linear_x = [[-3.0, 1.0], [-2.0, 0.0], [-1.0, 2.0], [0.0, -1.0], [1.0, 3.0], [2.0, 1.0], [4.0, -2.0]]
    linear_y = [4.0, 0.5, 5.5, -1.0, 8.0, 6.5, 5.0]
    linear_test = [[-1.5, 0.5], [0.5, 2.0], [3.0, -1.0]]
    # LabML prepends a bias column and regularizes it along with every feature.
    linear_design = np.column_stack([np.ones(len(linear_x)), linear_x])
    linear_test_design = np.column_stack([np.ones(len(linear_test)), linear_test])
    ridge = Ridge(alpha=1e-6, fit_intercept=False).fit(linear_design, linear_y)

    class_x = [
        [-3.0, -2.7], [-2.6, -3.2], [-2.2, -2.5], [-3.4, -3.1], [-2.8, -2.1],
        [-0.4, 2.7], [0.2, 3.3], [0.8, 2.5], [-0.8, 3.5], [0.5, 3.8],
        [2.3, -1.0], [3.1, -0.4], [2.7, 0.3], [3.6, -1.5], [2.0, 0.8],
    ]
    class_y = [0] * 5 + [1] * 5 + [2] * 5
    class_test = [[-2.7, -2.6], [0.1, 3.0], [2.8, -0.5], [1.2, 1.4]]
    classifier = KNeighborsClassifier(n_neighbors=5).fit(class_x, class_y)

    regression_x = [[float(i)] for i in range(10)]
    regression_y = [0.0, 1.5, 1.0, 4.0, 3.5, 6.0, 8.0, 7.5, 10.0, 12.0]
    regression_test = [[1.2], [4.4], [7.8]]
    regressor = KNeighborsRegressor(n_neighbors=5).fit(regression_x, regression_y)

    return {
        "linear": {
            "XTrain": linear_x,
            "yTrain": linear_y,
            "XTest": linear_test,
            "predictions": floats(ridge.predict(linear_test_design)),
        },
        "knnClassifier": {
            "XTrain": class_x,
            "yTrain": class_y,
            "XTest": class_test,
            "predictions": classifier.predict(class_test).astype(int).tolist(),
            "probabilities": classifier.predict_proba(class_test).tolist(),
        },
        "knnRegressor": {
            "XTrain": regression_x,
            "yTrain": regression_y,
            "XTest": regression_test,
            "predictions": floats(regressor.predict(regression_test)),
        },
    }


def main() -> None:
    reference = {
        "provenance": {
            "generator": "tests/golden/generate.py",
            "python": platform.python_version(),
            "scikitLearn": sklearn.__version__,
        },
        "metrics": metrics(),
        "models": models(),
    }
    OUTPUT.write_text(
        json.dumps(reference, indent=2, ensure_ascii=True) + "\n", encoding="utf-8"
    )
    print(f"Wrote {OUTPUT} with scikit-learn {sklearn.__version__}")


if __name__ == "__main__":
    main()

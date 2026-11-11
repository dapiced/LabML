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
    classification_true = [0, 0, 0, 0, 0, 0, 1, 1, 1, 2]
    classification_pred = [0, 0, 0, 0, 1, 2, 1, 1, 2, 2]
    probabilities = [
        [0.80, 0.15, 0.05],
        [0.70, 0.20, 0.10],
        [0.60, 0.25, 0.15],
        [0.65, 0.25, 0.10],
        [0.30, 0.55, 0.15],
        [0.20, 0.30, 0.50],
        [0.15, 0.70, 0.15],
        [0.05, 0.90, 0.05],
        [0.15, 0.35, 0.50],
        [0.05, 0.15, 0.80],
    ]
    binary_true = [0, 0, 1, 1, 0, 1, 0, 1]
    binary_scores = [0.10, 0.40, 0.40, 0.80, 0.25, 0.65, 0.25, 0.65]
    regression_true = [3.0, -0.5, 2.0, 7.0, 4.5, 1.25]
    regression_pred = [2.5, 0.0, 2.0, 8.0, 3.75, 1.5]

    # V50: the task knows four classes, the evaluated rows carry three of
    # them, and class 2 is predicted but never true. scikit-learn's macro
    # average runs over the labels present in y_true or y_pred, so class 3
    # (in neither) does not count and class 2 (predicted only) counts as 0.
    # A batch scored on a subset of the classes is the everyday case.
    absent_true = [0, 0, 0, 1, 1, 1, 1]
    absent_pred = [0, 0, 1, 1, 1, 2, 1]

    return {
        "absentClass": {
            "classCount": 4,
            "yTrue": absent_true,
            "yPred": absent_pred,
            "precision": precision_score(
                absent_true, absent_pred, average="macro", zero_division=0
            ),
            "recall": recall_score(absent_true, absent_pred, average="macro", zero_division=0),
            "f1": f1_score(absent_true, absent_pred, average="macro", zero_division=0),
        },
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

    # The first query deliberately has a different five-neighbor set under
    # Manhattan distance. This makes the fixture verify Euclidean distance,
    # not only generic nearest-neighbor voting.
    neighbor_x = [
        [1.0, -1.0],
        [0.0, 1.0],
        [-6.0, -5.0],
        [-3.0, -5.0],
        [-1.0, 2.0],
        [2.0, 0.0],
        [5.0, 1.0],
        [-5.0, 3.0],
        [1.0, 2.0],
        [1.0, 1.0],
        [-5.0, 1.0],
        [4.0, -3.0],
    ]
    class_y = [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2]
    neighbor_test = [[-3.7534573234564848, -0.5062608861411011], [0.5, 1.5], [3.0, -1.5]]
    classifier = KNeighborsClassifier(n_neighbors=5).fit(neighbor_x, class_y)

    regression_y = [float(i) for i in range(len(neighbor_x))]
    regressor = KNeighborsRegressor(n_neighbors=5).fit(neighbor_x, regression_y)

    return {
        "linear": {
            "XTrain": linear_x,
            "yTrain": linear_y,
            "XTest": linear_test,
            "predictions": floats(ridge.predict(linear_test_design)),
        },
        "knnClassifier": {
            "XTrain": neighbor_x,
            "yTrain": class_y,
            "XTest": neighbor_test,
            "predictions": classifier.predict(neighbor_test).astype(int).tolist(),
            "probabilities": classifier.predict_proba(neighbor_test).tolist(),
        },
        "knnRegressor": {
            "XTrain": neighbor_x,
            "yTrain": regression_y,
            "XTest": neighbor_test,
            "predictions": floats(regressor.predict(neighbor_test)),
        },
    }


def conformal_quantile(scores: list[float], alpha: float) -> float | None:
    """The ceil((n+1)(1-alpha))-th smallest score, or None when it does not exist.

    Computed two independent ways and required to agree: by rank on the sorted
    scores, and as numpy's inverted-CDF quantile at level rank/n.
    """
    n = len(scores)
    rank = int(np.ceil((n + 1) * (1 - alpha) - 1e-9))
    if rank > n:
        return None
    by_rank = float(np.sort(np.asarray(scores, dtype=float))[rank - 1])
    by_numpy = float(
        np.quantile(np.asarray(scores, dtype=float), (rank - 0.5) / n, method="inverted_cdf")
    )
    assert by_rank == by_numpy, (by_rank, by_numpy)
    return by_rank


def conformal() -> dict[str, object]:
    """Split conformal prediction on fixed data. numpy only: the method is a quantile."""
    calibration_proba = [
        [0.80, 0.15, 0.05],
        [0.10, 0.70, 0.20],
        [0.05, 0.15, 0.80],
        [0.55, 0.35, 0.10],
        [0.30, 0.45, 0.25],
        [0.20, 0.20, 0.60],
        [0.40, 0.50, 0.10],
        [0.15, 0.60, 0.25],
        [0.25, 0.30, 0.45],
        [0.70, 0.20, 0.10],
        [0.35, 0.25, 0.40],
        [0.10, 0.25, 0.65],
    ]
    calibration_labels = [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 0, 2]
    test_proba = [
        [0.90, 0.07, 0.03],
        [0.40, 0.35, 0.25],
        [0.34, 0.33, 0.33],
        [0.05, 0.90, 0.05],
        [0.20, 0.30, 0.50],
        [0.48, 0.47, 0.05],
    ]
    test_labels = [0, 1, 2, 1, 2, 0]
    class_scores = [1 - row[label] for row, label in zip(calibration_proba, calibration_labels)]

    calibration_pred = [10.0, 12.5, 9.0, 15.0, 11.0, 13.5, 8.0, 14.0, 10.5, 12.0, 9.5, 16.0]
    calibration_true = [11.0, 12.0, 9.5, 13.0, 11.2, 15.0, 8.4, 14.1, 9.0, 12.9, 9.5, 18.5]
    test_pred = [10.0, 14.0, 9.0, 12.0, 15.5, 11.0]
    test_true = [10.4, 16.0, 9.1, 11.0, 15.0, 13.9]
    residuals = [abs(t - p) for t, p in zip(calibration_true, calibration_pred)]

    levels: list[dict[str, object]] = []
    for alpha in (0.2, 0.1):
        q_class = conformal_quantile(class_scores, alpha)
        q_reg = conformal_quantile(residuals, alpha)
        assert q_class is not None and q_reg is not None
        sets = [
            [k for k, value in enumerate(row) if value >= 1 - q_class - 1e-12]
            for row in test_proba
        ]
        covered = [abs(t - p) <= q_reg + 1e-12 for t, p in zip(test_true, test_pred)]
        levels.append(
            {
                "alpha": alpha,
                "classificationQuantile": q_class,
                "sets": sets,
                "setCoverage": float(
                    np.mean([label in found for label, found in zip(test_labels, sets)])
                ),
                "meanSetSize": float(np.mean([len(found) for found in sets])),
                "regressionQuantile": q_reg,
                "intervalCoverage": float(np.mean(covered)),
            }
        )

    return {
        "calibrationProbabilities": calibration_proba,
        "calibrationLabels": calibration_labels,
        "testProbabilities": test_proba,
        "testLabels": test_labels,
        "calibrationPredictions": calibration_pred,
        "calibrationTargets": calibration_true,
        "testPredictions": test_pred,
        "testTargets": test_true,
        "levels": levels,
        # Five scores cannot carry a 90 % level: the rank asked for is the sixth.
        "tooFew": {"scores": [0.1, 0.4, 0.2, 0.9, 0.3], "alpha": 0.1, "quantile": None},
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
        "conformal": conformal(),
    }
    OUTPUT.write_text(
        json.dumps(reference, indent=2, ensure_ascii=True) + "\n", encoding="utf-8"
    )
    print(f"Wrote {OUTPUT} with scikit-learn {sklearn.__version__}")


if __name__ == "__main__":
    main()

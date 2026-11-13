"""Measures the gap between LabML and the scikit-learn script it exports (V64).

Not part of CI: CI has no scikit-learn. Run it only to regenerate the figures
of `python-bridge.md`, after the bench has written the scripts:

    LABML_BRIDGE_OUT=/tmp/bridge npx vitest run src/features/ml/train/python-bridge.bench.test.ts
    python tests/golden/python-bridge.py /tmp/bridge public/datasets

For every run it checks that the script encodes the training rows into the
matrix LabML encoded, then runs the script and collects, model by model, the
test metric of each side.
"""

from __future__ import annotations

import contextlib
import glob
import importlib.util
import io
import json
import sys

import numpy as np


def load(path: str):
    spec = importlib.util.spec_from_file_location("run", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    root, data = sys.argv[1], sys.argv[2]
    gaps: dict[tuple[str, str, str, str], list[float]] = {}
    worst_matrix = 0.0
    scripts = sorted(glob.glob(f"{root}/*.py"))
    for path in scripts:
        module = load(path)
        config = module.CONFIG
        source = f"{data}/{config['source']}"
        frame = module.read_table(source, config)
        features = module.prepare(frame, config)
        design = module.preprocessing(config)
        encoded = design.fit_transform(features.iloc[config["split"]["train"]])
        with open(path[:-3] + ".matrix.json", encoding="utf-8") as handle:
            lab = np.array(json.load(handle)["train"], dtype=float)
        if lab.shape != encoded.shape:
            sys.exit(f"{path}: LabML encoded {lab.shape}, the script {encoded.shape}.")
        worst_matrix = max(worst_matrix, float(np.abs(lab - encoded).max()))
        with contextlib.redirect_stdout(io.StringIO()):
            results = module.run(config, source)
        relation = {model["key"]: model["relation"] for model in config["models"]}
        for result in results:
            key = (config["source"], config["task"], result["key"], relation[result["key"]])
            gaps.setdefault(key, []).append(result["sklearn"] - result["lab"])

    print(f"{len(scripts)} runs. Encoded matrix, worst absolute difference: {worst_matrix:.1e}")
    print()
    print("| File | Model | Relation | Mean gap | Worst gap |")
    print("| --- | --- | --- | --- | --- |")
    for (source, task, key, relation), values in gaps.items():
        array = np.array(values)
        worst = array[int(np.argmax(np.abs(array)))]
        unit = "accuracy" if task == "classification" else "RMSE"
        print(f"| {source} ({unit}) | {key} | {relation} | {array.mean():+.4f} | {worst:+.4f} |")


if __name__ == "__main__":
    main()

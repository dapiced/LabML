/**
 * V64: a run, redone in Python.
 *
 * A run stays inside the browser. Its model exports, its predictions and its
 * report too; the training itself does not. This writes a scikit-learn script
 * that redoes it: the same rows in each split, the same columns, the same
 * preprocessing, and each model family translated to its nearest
 * scikit-learn estimator.
 *
 * Two things are carried exactly, and they are the two that make a comparison
 * mean anything: WHICH rows train and which test (the indices are in the
 * script), and HOW a row becomes numbers (median, mean and deviation, the
 * categories and their order).
 *
 * The models are translated, not copied. The lab's estimators are written by
 * hand or come from ml.js; `tests/golden/README.md` has said since V42 that
 * requiring the same numbers of a tree, a forest, a boosting or a network
 * « would be a false contract ». So the script does not promise the lab's
 * figures: it prints them next to its own, with the gap. The gaps measured on
 * the demos are in `tests/golden/python-bridge.md`.
 *
 * A column name is never code. The run travels as one JSON block read by
 * `json.loads`; everything else in the script is the same text for every run.
 *
 * Pure and deterministic.
 */
import type { FittedPipeline } from '@/features/ml/train/pipeline';
import type { MetricMap, ModelKey } from '@/features/ml/train/types';

type FeatureSpec = FittedPipeline['specs'][number];

/** How each family of the lab relates to the estimator the script uses. */
export type Relation = 'same' | 'same-ties' | 'translated';

interface Family {
  /** scikit-learn class, classification then regression; null where the task has none. */
  classifier: string | null;
  regressor: string | null;
  relation: Relation;
}

/**
 * `same`: the algorithm is the same and the figures agree (ridge is tested
 * against scikit-learn in `tests/golden`; the baseline is a constant; the
 * Gaussian naive Bayes agreed on every one of the runs measured).
 * `same-ties`: the same algorithm, k-NN, whose figures agree until two
 * neighbours sit at the same distance: each library breaks that tie its own
 * way, which shows on a file with few distinct rows. `translated`: the same
 * family, another implementation.
 */
export const FAMILIES: Partial<Record<ModelKey, Family>> = {
  baseline: { classifier: 'DummyClassifier', regressor: 'DummyRegressor', relation: 'same' },
  linear: { classifier: null, regressor: 'Ridge', relation: 'same' },
  knn: {
    classifier: 'KNeighborsClassifier',
    regressor: 'KNeighborsRegressor',
    relation: 'same-ties',
  },
  logistic: { classifier: 'LogisticRegression', regressor: null, relation: 'translated' },
  naiveBayes: { classifier: 'GaussianNB', regressor: null, relation: 'same' },
  tree: {
    classifier: 'DecisionTreeClassifier',
    regressor: 'DecisionTreeRegressor',
    relation: 'translated',
  },
  forest: {
    classifier: 'RandomForestClassifier',
    regressor: 'RandomForestRegressor',
    relation: 'translated',
  },
  gbdt: {
    classifier: 'HistGradientBoostingClassifier',
    regressor: 'HistGradientBoostingRegressor',
    relation: 'translated',
  },
  mlp: { classifier: 'MLPClassifier', regressor: 'MLPRegressor', relation: 'translated' },
};

/** The hyperparameters the lab trains with, as the script needs them. */
export const LAB_PARAMS = {
  knn: { neighbors: 5 },
  linear: { ridge: 1e-6 },
  logistic: { l2: 1e-4 },
  tree: { maxDepth: 10, minSamplesSplit: 3 },
  forest: { trees: 40 },
  gbdt: {
    rounds: 120,
    learningRate: 0.1,
    maxDepth: 4,
    minChildSamples: 10,
    lambda: 1,
    maxBins: 32,
  },
  mlp: { l2: 1e-4, epochs: 300 },
} as const;

export interface PythonExportInput {
  appVersion: string;
  /** The file as the lab read it. */
  source: string;
  rowCount: number;
  header: readonly string[];
  delimiter: string;
  encoding: string;
  /** Columns the lab rewrote from the French number form (`1 234,5`). */
  decimalColumns: readonly string[];
  /** Rows the file did not deliver as declared (V35); the script cannot redo that reading. */
  malformedRows: number;
  target: string;
  isClassification: boolean;
  classes: readonly string[];
  seed: number;
  classWeighting: boolean;
  specs: readonly FeatureSpec[];
  /** Encoded feature count: the lab sizes its network from it. */
  featureCount: number;
  split: { train: readonly number[]; validation: readonly number[]; test: readonly number[] };
  /** Every model of the run, with its test metrics and the rows it was fitted on. */
  models: readonly { key: ModelKey; metrics: MetricMap; trainedRows?: number }[];
}

type FeatureConfig =
  | { name: string; kind: 'numeric' }
  | { name: string; kind: 'onehot'; categories: string[]; mode: string }
  | { name: string; kind: 'ordinal'; categories: string[]; mode: string }
  | { name: string; kind: 'text'; terms: string[] };

export interface PythonConfig {
  labml: string;
  source: string;
  rows: number;
  header: string[];
  delimiter: string;
  encoding: string;
  decimal_columns: string[];
  target: string;
  task: 'classification' | 'regression';
  classes: string[];
  seed: number;
  class_weighting: boolean;
  feature_count: number;
  features: FeatureConfig[];
  params: typeof LAB_PARAMS;
  models: {
    key: string;
    estimator: string;
    relation: Relation;
    lab: Record<string, number>;
    /** Present when the lab fitted this family on a sample of the training rows. */
    lab_trained_rows?: number;
  }[];
  /** Models of the run the script does not redo, by key. */
  not_redone: string[];
  /** Things the reader must know before trusting a comparison, as codes. */
  notes: string[];
  split: { train: readonly number[]; validation: readonly number[]; test: readonly number[] };
}

const isSpreadsheet = (name: string) => /\.(xlsx|xls)$/i.test(name);

function featureConfig(spec: FeatureSpec): FeatureConfig {
  if (spec.kind === 'numeric') return { name: spec.name, kind: 'numeric' };
  if (spec.kind === 'onehot') {
    return { name: spec.name, kind: 'onehot', categories: [...spec.categories], mode: spec.mode };
  }
  if (spec.kind === 'text') return { name: spec.name, kind: 'text', terms: [...spec.terms] };
  // Categories in rank order: the rank IS the encoding.
  const byRank = [...spec.ranks.entries()].sort((a, b) => a[1] - b[1]).map(([value]) => value);
  return { name: spec.name, kind: 'ordinal', categories: byRank, mode: spec.mode };
}

function finite(metrics: MetricMap): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(metrics)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[name] = value;
  }
  return out;
}

export function buildPythonConfig(input: PythonExportInput): PythonConfig {
  const models: PythonConfig['models'] = [];
  const notRedone: string[] = [];
  let capped = false;
  for (const model of input.models) {
    const family = FAMILIES[model.key];
    const estimator = family
      ? input.isClassification
        ? family.classifier
        : family.regressor
      : null;
    if (!family || !estimator) {
      notRedone.push(model.key);
      continue;
    }
    const sampled = model.trainedRows !== undefined && model.trainedRows < input.split.train.length;
    if (sampled) capped = true;
    models.push({
      key: model.key,
      estimator,
      relation: family.relation,
      lab: finite(model.metrics),
      ...(sampled && { lab_trained_rows: model.trainedRows }),
    });
  }

  const notes: string[] = [];
  if (isSpreadsheet(input.source)) notes.push('spreadsheet');
  if (input.malformedRows > 0) notes.push('malformed-rows');
  if (input.specs.some((spec) => spec.kind === 'text')) notes.push('text-columns');
  if (capped) notes.push('sampled-training');
  if (input.classWeighting) notes.push('class-weighting');

  return {
    labml: input.appVersion,
    source: input.source,
    rows: input.rowCount,
    header: [...input.header],
    delimiter: input.delimiter,
    encoding: input.encoding,
    decimal_columns: [...input.decimalColumns],
    target: input.target,
    task: input.isClassification ? 'classification' : 'regression',
    classes: [...input.classes],
    seed: input.seed,
    class_weighting: input.classWeighting,
    feature_count: input.featureCount,
    features: input.specs.map(featureConfig),
    params: LAB_PARAMS,
    models,
    not_redone: notRedone,
    notes,
    split: input.split,
  };
}

/**
 * The configuration as text that is safe inside a Python raw triple-quoted
 * string. Every apostrophe becomes its JSON escape, so the block cannot hold
 * the three quotes that would close the string, whatever a column is called.
 * The row indices go on one line each: readable, and not ten thousand lines.
 */
export function configText(config: PythonConfig): string {
  const marks = { train: '@@train@@', validation: '@@validation@@', test: '@@test@@' };
  const text = JSON.stringify({ ...config, split: marks }, null, 2);
  const safe = text.replace(/'/g, '\\u0027');
  return safe
    .replace(`"${marks.train}"`, `[${config.split.train.join(',')}]`)
    .replace(`"${marks.validation}"`, `[${config.split.validation.join(',')}]`)
    .replace(`"${marks.test}"`, `[${config.split.test.join(',')}]`);
}

/** The script, whole. The run is the CONFIG block; the rest never changes. */
export function buildPythonScript(input: PythonExportInput): string {
  return `${HEADER}\nCONFIG = json.loads(r'''\n${configText(buildPythonConfig(input))}\n''')\n${BODY}`;
}

const HEADER = `#!/usr/bin/env python3
"""A LabML run, redone with scikit-learn.

Written by LabML (https://app.dominicdapice.com/ml). It redoes the training of
one run outside the browser: the same rows in each split, the same columns,
the same preprocessing, and each model translated to its nearest scikit-learn
estimator.

What is carried exactly: which rows train and which test, and how a row
becomes numbers. What is translated: the models. LabML's estimators are
written by hand, so this script does not promise LabML's figures. It prints
them next to its own, with the gap. A gap is not an error: it is what
separates two implementations of the same idea.

    python this_script.py --data path/to/the/same/file.csv
    python this_script.py --check      (reads the run, needs no library)

Needs pandas and scikit-learn. It holds column names, row numbers and
settings, and no value of any row: the data stays where it is.
"""
import argparse
import json
import re
import sys
`;

const BODY = `
MISSING = {"", "na", "n/a", "null", "nan", "none", "-", "?"}
NUMBER = re.compile(r"^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?$")
FRENCH_NUMBER = re.compile(
    r"^[+-]?\\d{1,3}(?:[ \\u00a0\\u202f.]\\d{3})*(?:,\\d+)?$|^[+-]?\\d+(?:,\\d+)?$"
)

NOTES = {
    "spreadsheet": "The run read a spreadsheet. Save that sheet as CSV and pass it with --data.",
    "malformed-rows": "LabML found malformed rows in this file and handled them its own way. "
    "pandas will not read them the same way: clean the file first.",
    "text-columns": "Free-text columns go through TfidfVectorizer on LabML's vocabulary. The two "
    "tokenizers are not the same code: the weights agree on LabML's demo, and may not on yours.",
    "sampled-training": "LabML fitted some families on a sample of the training rows (see "
    "lab_trained_rows). This script fits them on all of them.",
    "class-weighting": "Class weighting was on. It is passed as class_weight='balanced' where the "
    "estimator takes it; LabML resamples for the families that do not.",
}

RELATIONS = {
    "same": "same algorithm",
    "same-ties": "same algorithm, equal distances broken differently",
    "translated": "same family, another implementation",
}


def is_missing(cell):
    return cell is None or cell.strip().lower() in MISSING


def to_number(cell):
    """A cell as LabML reads it: a plain number, or nothing."""
    if cell is None:
        return None
    text = cell.strip()
    return float(text) if NUMBER.match(text) else None


def normalize_number(cell):
    """The French form LabML rewrites on reading: 1 234,5 becomes 1234.5."""
    text = cell.strip()
    if not FRENCH_NUMBER.match(text):
        return cell
    return re.sub(r"[ \\u00a0\\u202f.]", "", text).replace(",", ".")


def check(config):
    """Validates the run without any library. Exits with a message on the first fault."""
    split = config["split"]
    seen = set()
    for name in ("train", "validation", "test"):
        rows = split[name]
        if any(not isinstance(row, int) or row < 0 or row >= config["rows"] for row in rows):
            sys.exit(f"The {name} split names a row outside the file.")
        if seen & set(rows):
            sys.exit(f"The {name} split shares rows with another split.")
        seen |= set(rows)
    if not split["train"] or not split["test"]:
        sys.exit("The run has no training rows or no test rows.")
    columns = set(config["header"])
    if config["target"] not in columns:
        sys.exit("The target is not a column of the file.")
    for feature in config["features"]:
        if feature["name"] not in columns:
            sys.exit(f"The feature {feature['name']!r} is not a column of the file.")
    print(
        f"{config['source']}: {config['rows']} rows, target {config['target']!r}, "
        f"{config['task']}, {len(config['features'])} columns, seed {config['seed']}."
    )
    print(
        f"Split: {len(split['train'])} train, {len(split['validation'])} validation, "
        f"{len(split['test'])} test."
    )
    for model in config["models"]:
        print(f"  {model['key']} -> {model['estimator']} ({RELATIONS[model['relation']]})")
    for key in config["not_redone"]:
        print(f"  {key} -> not redone by this script")


def read_table(path, config):
    import pandas as pd

    frame = pd.read_csv(
        path,
        sep=config["delimiter"],
        encoding=config["encoding"],
        dtype=str,
        keep_default_na=False,
        na_filter=False,
    )
    if len(frame) != config["rows"] or len(frame.columns) != len(config["header"]):
        sys.exit(
            f"This is not the file of the run: {len(frame)} rows and {len(frame.columns)} "
            f"columns, where the run read {config['rows']} and {len(config['header'])}."
        )
    frame.columns = config["header"]
    for name in config["decimal_columns"]:
        frame[name] = frame[name].map(normalize_number)
    return frame


def prepare(frame, config):
    """Cells as LabML reads them: numbers or NaN, labels or NaN, text or ''."""
    import numpy as np
    import pandas as pd

    out = pd.DataFrame(index=frame.index)
    for feature in config["features"]:
        cells = frame[feature["name"]]
        if feature["kind"] == "numeric":
            out[feature["name"]] = [
                np.nan if is_missing(c) or to_number(c) is None else to_number(c) for c in cells
            ]
        elif feature["kind"] == "text":
            out[feature["name"]] = ["" if is_missing(c) else c.strip() for c in cells]
        else:
            out[feature["name"]] = pd.Series(
                [np.nan if is_missing(c) else c.strip() for c in cells],
                index=frame.index,
                dtype=object,
            )
    return out


def preprocessing(config):
    """One transformer per column, in LabML's order, fitted on the training rows only."""
    from sklearn.compose import ColumnTransformer
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder, StandardScaler

    steps = []
    for position, feature in enumerate(config["features"]):
        name = feature["name"]
        if feature["kind"] == "numeric":
            # Standardized on the values that are there, THEN missing becomes the median.
            # The other order would compute the mean and deviation on imputed cells.
            step = make_pipeline(StandardScaler(), SimpleImputer(strategy="median"))
            steps.append((f"c{position}", step, [name]))
        elif feature["kind"] == "onehot":
            # Missing becomes the most frequent label; a label never seen is all zeros.
            step = make_pipeline(
                SimpleImputer(strategy="constant", fill_value=feature["mode"]),
                OneHotEncoder(
                    categories=[feature["categories"]],
                    handle_unknown="ignore",
                    sparse_output=False,
                ),
            )
            steps.append((f"c{position}", step, [name]))
        elif feature["kind"] == "ordinal":
            # Too many labels for one column each: the rank by frequency, standardized.
            fallback = feature["categories"].index(feature["mode"])
            step = make_pipeline(
                SimpleImputer(strategy="constant", fill_value=feature["mode"]),
                OrdinalEncoder(
                    categories=[feature["categories"]],
                    handle_unknown="use_encoded_value",
                    unknown_value=fallback,
                ),
                StandardScaler(),
            )
            steps.append((f"c{position}", step, [name]))
        else:
            step = TfidfVectorizer(vocabulary=feature["terms"], strip_accents="unicode")
            steps.append((f"c{position}", step, name))
    return ColumnTransformer(steps, sparse_threshold=0.0)


def estimator(key, config, rows):
    """LabML's settings, on the nearest scikit-learn estimator."""
    from sklearn import dummy, ensemble, linear_model, naive_bayes, neighbors, neural_network, tree
    from sklearn.compose import TransformedTargetRegressor
    from sklearn.preprocessing import StandardScaler

    p = config["params"]
    seed = config["seed"]
    weight = "balanced" if config["class_weighting"] else None
    hidden = max(16, min(64, 2 * config["feature_count"]))
    boosting = dict(
        max_iter=p["gbdt"]["rounds"],
        learning_rate=p["gbdt"]["learningRate"],
        max_depth=p["gbdt"]["maxDepth"],
        min_samples_leaf=p["gbdt"]["minChildSamples"],
        l2_regularization=p["gbdt"]["lambda"],
        max_bins=p["gbdt"]["maxBins"],
        early_stopping=False,
        random_state=seed,
    )
    if config["task"] == "classification":
        return {
            "baseline": lambda: dummy.DummyClassifier(strategy="most_frequent"),
            # LabML runs a fixed number of gradient steps; this solves the same problem to the end.
            "logistic": lambda: linear_model.LogisticRegression(
                C=1.0 / (p["logistic"]["l2"] * rows), max_iter=2000, class_weight=weight
            ),
            "knn": lambda: neighbors.KNeighborsClassifier(n_neighbors=p["knn"]["neighbors"]),
            "naiveBayes": lambda: naive_bayes.GaussianNB(),
            "tree": lambda: tree.DecisionTreeClassifier(
                max_depth=p["tree"]["maxDepth"],
                min_samples_split=p["tree"]["minSamplesSplit"],
                random_state=seed,
                class_weight=weight,
            ),
            "forest": lambda: ensemble.RandomForestClassifier(
                n_estimators=p["forest"]["trees"], random_state=seed, class_weight=weight
            ),
            "gbdt": lambda: ensemble.HistGradientBoostingClassifier(class_weight=weight, **boosting),
            "mlp": lambda: neural_network.MLPClassifier(
                hidden_layer_sizes=(hidden,),
                alpha=p["mlp"]["l2"],
                max_iter=p["mlp"]["epochs"],
                random_state=seed,
            ),
        }[key]()
    # LabML's network learns a standardized target and converts back.
    network = TransformedTargetRegressor(
        regressor=neural_network.MLPRegressor(
            hidden_layer_sizes=(hidden,),
            alpha=p["mlp"]["l2"],
            max_iter=p["mlp"]["epochs"],
            random_state=seed,
        ),
        transformer=StandardScaler(),
    )
    return {
        "baseline": lambda: dummy.DummyRegressor(strategy="mean"),
        "linear": lambda: linear_model.Ridge(alpha=p["linear"]["ridge"]),
        "knn": lambda: neighbors.KNeighborsRegressor(n_neighbors=p["knn"]["neighbors"]),
        "tree": lambda: tree.DecisionTreeRegressor(
            max_depth=p["tree"]["maxDepth"],
            min_samples_split=p["tree"]["minSamplesSplit"],
            random_state=seed,
        ),
        "forest": lambda: ensemble.RandomForestRegressor(
            n_estimators=p["forest"]["trees"], random_state=seed
        ),
        "gbdt": lambda: ensemble.HistGradientBoostingRegressor(**boosting),
        "mlp": lambda: network,
    }[key]()


def target_of(frame, config, rows):
    cells = frame[config["target"]].iloc[rows]
    if config["task"] == "classification":
        index = {label: position for position, label in enumerate(config["classes"])}
        return [index[cell.strip()] for cell in cells]
    return [to_number(cell) for cell in cells]


def run(config, path):
    import warnings

    from sklearn import metrics

    frame = read_table(path, config)
    features = prepare(frame, config)
    split = config["split"]
    design = preprocessing(config)
    train_x = design.fit_transform(features.iloc[split["train"]])
    test_x = design.transform(features.iloc[split["test"]])
    train_y = target_of(frame, config, split["train"])
    test_y = target_of(frame, config, split["test"])

    for code in config["notes"]:
        print(f"Note: {NOTES.get(code, code)}")
    metric = "accuracy" if config["task"] == "classification" else "rmse"
    print(
        f"{config['source']}: {len(split['train'])} training rows, {len(split['test'])} test rows, "
        f"{train_x.shape[1]} encoded columns (LabML: {config['feature_count']})."
    )
    print(f"{'model':<12} {'LabML':>9} {'sklearn':>9} {'gap':>9}  relation ({metric} on the test rows)")
    results = []
    for model in config["models"]:
        fitted = estimator(model["key"], config, len(split["train"]))
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            fitted.fit(train_x, train_y)
        predicted = fitted.predict(test_x)
        if metric == "accuracy":
            value = metrics.accuracy_score(test_y, predicted)
        else:
            value = metrics.mean_squared_error(test_y, predicted) ** 0.5
        lab = model["lab"].get(metric)
        gap = None if lab is None else value - lab
        results.append({"key": model["key"], "lab": lab, "sklearn": value, "gap": gap})
        shown = "        -" if lab is None else f"{lab:9.4f}"
        delta = "        -" if gap is None else f"{gap:+9.4f}"
        print(
            f"{model['key']:<12} {shown} {value:9.4f} {delta}  "
            f"{model['estimator']}, {RELATIONS[model['relation']]}"
        )
    for key in config["not_redone"]:
        print(f"{key:<12} not redone by this script")
    return results


def main():
    parser = argparse.ArgumentParser(description="A LabML run, redone with scikit-learn.")
    parser.add_argument("--data", default=CONFIG["source"], help="the file the run was made on")
    parser.add_argument("--check", action="store_true", help="read the run, with no library")
    parser.add_argument("--json", action="store_true", help="print the results as JSON too")
    args = parser.parse_args()
    check(CONFIG)
    if args.check:
        return
    results = run(CONFIG, args.data)
    if args.json:
        print(json.dumps(results))


if __name__ == "__main__":
    main()
`;

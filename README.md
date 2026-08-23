# LabML

**A complete machine learning lab that runs entirely in your browser.** Drop a CSV, audit and
clean it, train and compare models, understand where they fail, and score new data — your
dataset never leaves your machine.

**Live at [app.dominicdapice.com](https://app.dominicdapice.com)** · MIT licensed · Built by
[Dominic D'Apice](https://dominicdapice.com)

---

## Overview

LabML is a privacy-first, offline-capable web application covering the full tabular ML
workflow — data quality, training, evaluation, explanation, and reuse — with **no backend, no
accounts, and no uploads**. Every computation (parsing, cleaning, training, inference) runs in
Web Workers on the user's own machine.

The project follows three non-negotiable principles:

- **Privacy by architecture.** A strict Content-Security-Policy allows zero third-party
  calls. Data lives in worker memory; persistence (run history, opted-in datasets) uses
  IndexedDB locally; share links carry metrics in the URL fragment, which browsers never
  send to any server. `/privacy` states this in plain language and hands the reader a
  four-step protocol to verify it in their own DevTools — the policy quoted there is
  pinned to the served header by a unit test, so the page cannot claim a protection the
  site stopped shipping.
- **Honest evaluation.** Every run is scored against a naive baseline on a held-out test
  set. Models are **selected on a validation split and reported on a third, never-selected
  test split**, with the gap between the two shown — crowning the best of nine on the
  reporting set is what makes a headline figure optimistic. Metrics ship with 95% bootstrap
  intervals, per-segment breakdowns, calibration curves, and explicit refusals when a number
  would be noise (tiny slices, tiny test sets, a model whose probabilities are saturated).
  **The ranking metric is yours to pick** — accuracy rewards always answering the majority
  class, so on an imbalanced target you rank on F1 or recall instead, and the order changes.
- **Hand-written, deterministic ML.** The model zoo, search, explanations, and statistics
  are implemented from scratch in TypeScript, seeded end to end — the same seed always
  reproduces the same run.

## Features

### ML Lab — `/ml`

| Area           | What it does                                                                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data in        | Drag & drop CSV/Excel (parsed in a worker), demo datasets, per-column profiling, automatic task detection, smart exclusions and **target-leakage detection**; **free-text columns** join the pipeline as hand-written TF-IDF (FR/EN tokenization, capped vocabulary, fitted on the training split only) |
| Models         | 8 classifiers / 7 regressors trained live: naive baseline, linear/logistic regression, k-NN, Gaussian Naive Bayes, decision tree, random forest, **hand-written histogram gradient boosting** (LightGBM-style) and **MLP** (seeded He init, Adam)                                                       |
| Leaderboard    | Accuracy/F1/ROC-AUC/log-loss or RMSE/MAE/R², delta vs baseline, train time, inference latency p50/p95, **95% bootstrap intervals** with a paired winner-vs-baseline verdict                                                                                                                             |
| Understanding  | Confusion matrix, ROC, permutation importance, partial dependence, live what-if with **exact Shapley explanations**, **signed word effects** for text columns (which words push the answer up or down), plain-language read (FR/EN, rule-generated)                                                     |
| Where it fails | **Per-segment analysis**: the test set sliced by every categorical column — including excluded ones, where proxy effects hide — worst gaps first                                                                                                                                                        |
| Imbalance      | Precision-recall curve (AP), calibration curve (Brier), **cost-priced decision threshold** with the optimal cut computed by exhaustive sweep                                                                                                                                                            |
| Tuning         | Seeded random search scored by stratified 3-fold cross-validation, pipeline refitted inside each fold — the test set is scored exactly once                                                                                                                                                             |
| More data?     | **Learning curve** on demand: one model retrained on growing seeded nested fractions, 95% bootstrap band, plain verdict — still climbing (collect more rows) or flattened (work on features) — including whether an announced training cap costs accuracy                                               |
| No target?     | Seeded k-means (k chosen by silhouette) + power-iteration PCA projection, groups described in plain language; date column? **Holt-Winters forecasting** validated by rolling-origin backtest                                                                                                            |
| MLOps loop     | Score a **new batch** with honest test-vs-batch metrics; **compare two runs** side by side with cross-run uncertainty verdicts; **export a model as JSON and re-import it later** — the exact predictor is rebuilt (byte-identical predictions) and scores any CSV without retraining                   |
| Persistence    | Local run history with attached artifacts, opted-in dataset storage (compressed, explicit 50 MB budget), self-contained HTML reports, data-free share links                                                                                                                                             |

### Data Studio — `/data`

- **Quality report** with a deterministic 0–100 score: missing cells, duplicates,
  case/whitespace variants, Tukey-fence outliers, constant/near-empty/id columns.
- **Replayable cleaning recipe** — trim, merge variants, deduplicate, impute, clamp
  outliers, force column types, expand dates — exportable as JSON and re-runnable on new
  files, with a seeded **isolation-forest anomaly step** for multivariate outliers.
- **Left-join a second file** on a shared key: match rate, duplicates and orphans are
  named, never silent; the joined result becomes the working dataset.
- **Drift check**: compare a new batch against the reference — schema diff, PSI per
  column, new/vanished categories, severity verdict on conventional thresholds.
- One-click hand-off to the ML Lab.

### AI Playground — `/ai`

- **Vision** (`/ai/vision`): on-device image analysis on ONNX Runtime Web (WebAssembly)
  with three self-hosted models — **EfficientNet-Lite4** classification (1,000 ImageNet
  classes, 77.6% top-1), **YOLOX-Nano** object detection (80 COCO classes) and
  **UltraFace** face detection — boxes drawn on the image, hand-written and unit-tested
  box decoding (grids, IoU, NMS), webcam supported; the photo never leaves the browser.
- **Analytical SQL** (`/data`): a real OLAP engine — DuckDB-Wasm, MIT, self-hosted and
  single-threaded — queries the loaded file in the browser, plus any CSV, **Parquet** or
  JSON attached in the session. Results export to CSV or move to the ML Lab in one click;
  SQL errors show DuckDB's own message. The engine is pinned to 1.28.0 for a measured
  reason: from 1.29 its binaries exceed Cloudflare's 25 MiB per-file limit.
- **Data assistant** (`/ai/chat`): plain French or English questions about a loaded
  dataset (averages, counts, top-N, correlations…) answered by a deterministic local
  interpreter — when it does not understand, it says so. A **real local language model**
  (Qwen3-0.6B, 355 MB, Apache-2.0, self-hosted and split into 24 MiB parts to clear
  Cloudflare's limit) can be downloaded on explicit consent to read free-form phrasings:
  it only _translates_ the question into a query — the deterministic engine still
  computes every number, the translation is validated against a closed grammar, and a
  badge under each answer names which engine produced it. The deterministic parser reads
  **first** and is never overridden: it can only name a column that exists and a value
  that occurs in it, so the model is asked only about the questions it gives up on.
  WebGPU required; without it the refusal is named and the deterministic interpreter
  stays fully available.

## Engineering notes

- **Everything off the main thread.** Parsing, cleaning, training, scoring and analysis
  run in dedicated Web Workers behind typed message protocols.
- **From-scratch algorithms**, unit-tested against known results: gradient boosting
  (quantile bins, second-order gains, Newton leaves), MLP, k-means++, PCA, Holt-Winters,
  isolation forest, PSI, Shapley values, bootstrap intervals, PR/ROC/calibration curves,
  TF-IDF (bilingual tokenizer, smoothed IDF, L2-normalized vectors), and detection
  post-processing (YOLOX grid decode, IoU, non-maximum suppression).
- **Leakage discipline.** Preprocessing (imputation, one-hot/ordinal encoding,
  standardization) is fitted on the training split only; cross-validation refits the
  pipeline inside each fold; forecast backtests never peek at the future. Dated files can
  be split **chronologically** and grouped files **by group**, both announced — a random
  split puts the future in training. A one-column stump flags any lone column that predicts
  the target at 99%: that is a leak warning, never a victory.
- **Determinism.** A single seed drives splits, model initialization, search, sampling
  and resampling — runs are exactly reproducible, and the test suite depends on it.
- **Scale, honestly.** 100k–1M-row files train comfortably: past 100 000 usable rows an
  **announced** seeded stratified sample takes over (never silent — the leaderboard says
  so), slow model families train on measured, announced caps scored against the same
  full test set, and parsing refuses past a named 20M-cell memory budget instead of
  letting the tab die.
- **Performance.** Every section serves a prerendered static shell (hero paints before
  JavaScript); Lighthouse mobile ≈ 0.99 on `/ml` under real throttling. Heavy
  dependencies (Dexie, SheetJS, ONNX Runtime) load lazily.
- **Quality bar.** 387 unit tests, 69 Playwright end-to-end tests (including offline PWA,
  fake-webcam and axe-core WCAG A/AA accessibility checks), strict TypeScript, ESLint,
  Prettier, and Lighthouse budgets — all enforced in CI.

## Tech stack

React 19 · TypeScript (strict) · Vite · Tailwind CSS v4 · react-router · zustand ·
i18next (bilingual EN/FR) · Dexie (IndexedDB) · Papa Parse · SheetJS · ONNX Runtime Web ·
DuckDB-Wasm · Transformers.js · Vitest + Testing Library · Playwright · GitHub Actions ·
Cloudflare Pages

## Getting started

Requires Node 20+.

```bash
npm ci             # install dependencies
npm run dev        # start the dev server
```

| Script                                  | Purpose                            |
| --------------------------------------- | ---------------------------------- |
| `npm run test`                          | Unit tests (Vitest)                |
| `npm run e2e`                           | End-to-end tests (Playwright)      |
| `npm run typecheck`                     | TypeScript, strict mode            |
| `npm run lint` / `npm run format:check` | ESLint / Prettier                  |
| `npm run build`                         | Production build to `dist/`        |
| `npm run preview`                       | Serve the production build locally |
| `npm run llm:prepare`                   | Fetch and split the local LLM      |

The language model behind the data assistant is **not committed** (355 MB). `npm run
llm:prepare` downloads it into `public/llm/` and splits it into parts under Cloudflare's
25 MiB per-file limit; CI runs it before the production build. Skip it and everything
else works — the assistant simply falls back to its deterministic interpreter, which is
the default in any case.

## Deployment

CI builds, tests and deploys on every push: pull requests get a Cloudflare Pages preview,
`main` deploys to production. Required repository secrets: `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` — see [docs/guide-cloudflare.md](docs/guide-cloudflare.md).

## Roadmap

Development proceeds in planned "caps" of feature waves; six caps have shipped (MVP
through the lab meeting the real world — real photos, real text, real file sizes). The full plan, delivery log and design decisions live in
[PLAN.md](PLAN.md).

## License

[MIT](LICENSE) © Dominic D'Apice

Redistributed third-party material — the vision and language models, the self-hosted
WebAssembly runtimes, and the demo datasets — is attributed in [NOTICE](NOTICE).

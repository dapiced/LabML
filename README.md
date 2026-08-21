# LabML

[![CI](https://github.com/dapiced/LabML/actions/workflows/ci.yml/badge.svg)](https://github.com/dapiced/LabML/actions/workflows/ci.yml)

**EN** — A privacy-first machine learning lab that runs entirely in your browser: drop a CSV,
pick a target, train and compare models — your data never leaves your machine.
**FR** — Un laboratoire de machine learning privacy-first qui tourne entièrement dans votre
navigateur : déposez un CSV, choisissez une cible, entraînez et comparez des modèles — vos
données ne quittent jamais votre machine.

Deployed at **https://app.dominicdapice.com** (`/ml` — ML Lab; `/data` and `/ai` planned).

## Status

- **Sprint 0 — shipped**: design system (dual light/dark theme, teal + copper palette),
  bilingual FR/EN interface, path-based routing shell, CI/CD to Cloudflare Pages.
- **Sprint 1 — shipped**: the data engine. Drag & drop a CSV (parsed in a Web Worker,
  never uploaded) or pick a demo dataset (iris, titanic, mpg); per-column type inference
  and profiling (distributions, missing rates, cardinality); target selection with
  automatic task detection (binary / multi-class / regression); smart exclusions
  (identifiers, constants, near-empty columns) and **target-leakage detection**.
- **Sprint 2 — shipped**: the in-browser training engine. Leakage-free preprocessing
  pipeline (imputation, one-hot/ordinal encoding, standardization — fitted on the train
  split only), seeded stratified 80/20 split, and a model zoo trained in the Web Worker:
  naive baseline, logistic/linear regression, k-NN, Gaussian Naive Bayes, decision tree,
  random forest. Live leaderboard with accuracy/F1/ROC-AUC/log-loss (or RMSE/MAE/R²),
  delta vs baseline, training time and inference latency p50/p95. Fully reproducible
  (same seed ⇒ same results), cancellable between models.
- **Sprint 3 — shipped**: results & insights. Human-phrased confusion matrix, ROC curve,
  model-agnostic permutation importance, predicted-vs-actual and residuals for regression,
  a rule-generated plain-language read (FR/EN, no external API), live what-if predictions,
  and per-model inspection from the leaderboard.
- **Sprint 4 — shipped**: projects, export & sharing. Local run history (IndexedDB —
  metrics only, never the data) with rename/delete/compare, exports (model parameters as
  JSON, test predictions as CSV, self-contained HTML report), and data-free share links
  carried in the URL fragment.
- **Sprint 5 — shipped**: polish. WCAG A/AA verified by axe-core in the e2e suite,
  installable **offline-first PWA** (the whole lab — demo datasets included — works with
  the network cut, proven by an offline e2e test), Lighthouse budgets in CI
  (home: 98/100/100/100), reduced-motion support, skip link, and an in-app
  "How it works / Privacy" page.

**The MVP (Sprints 0–5) is complete.**

- **V2 (models) — shipped**: hand-written **histogram gradient boosting** (LightGBM-style
  quantile bins, second-order gains, Newton leaves — solves XOR interactions), a
  hand-written deterministic **neural network (MLP)** (seeded He init, full-batch Adam),
  **partial-dependence plots** on the top numeric drivers, and **Excel (.xlsx) import**
  (SheetJS, lazy-loaded). The zoo is now 8 classification / 7 regression models.
- **V3 (vision) — shipped**: the `/ai` section opens with an on-device **image
  classification playground** — SqueezeNet (1,000 ImageNet classes) executed by
  **ONNX Runtime Web** (WebAssembly) in a Web Worker. Model and runtime are
  self-hosted so the strict CSP still allows zero third-party calls, and both are
  runtime-cached by the service worker (works offline after first use). The photo
  never leaves the browser.
- **V4 (Data Studio) — shipped**: the `/data` section audits and repairs a dataset
  without uploading it. Quality report (missing cells, duplicate rows, case/whitespace
  spelling variants, Tukey-fence outliers, constant/near-empty/id columns) with a
  deterministic 0–100 score; a **cleaning recipe** (trim, merge variants, drop
  duplicates/columns, impute median/mode or drop rows, clamp outliers) applied live
  in a Web Worker with per-option counters; exports (cleaned CSV, recipe JSON) and a
  one-click **hand-off to the ML Lab**.
- **V5 (lab upgrades) — shipped**: **hyperparameter search** — seeded random search
  (up to 16 configurations) scored by stratified 3-fold cross-validation on the
  training split only, pipeline refitted inside each fold (no leakage), the held-out
  test set scored exactly once; and **Shapley explanations** for any what-if
  prediction — interventional permutation sampling (8 permutations × 24 reference
  rows, one-hot blocks grouped by source column) with the efficiency property holding
  exactly: the bars sum to prediction − baseline.
- **V6 (data assistant) — shipped**: `/ai/chat` answers plain French or English
  questions about a loaded dataset — averages, medians, counts under a condition,
  top N, breakdowns, Pearson correlations, missing values — through a
  **deterministic local interpreter** (a keyword grammar over the dataset's real
  column names and category values), honestly labeled as _not_ a language model.
  Questions and data never leave the browser; when it does not understand, it says
  so instead of guessing.
- **V7 (exploration) — shipped**: the ML Lab no longer requires a target.
  **"Explore without a target"** clusters the rows with a hand-written, seeded
  k-means (k-means++ init, k = 2–5 chosen by silhouette), projects them in 2D with
  a hand-written power-iteration **PCA**, and describes each group by its most
  distinctive traits in plain language. The scatter encodes groups with a
  **colorblind-validated palette** (checked by the design-system validator, light
  and dark) _and_ marker shapes — identity is never color-alone.
- **V8 (time series) — shipped**: when a dataset carries a date column, the lab
  forecasts any numeric value over time. Hand-written exponential-smoothing family
  (SES, Holt, additive **Holt-Winters** with seasonal-period detection), plus naive
  and seasonal-naive baselines; the winner is chosen by a **rolling-origin one-step
  backtest** that never peeks at the future, and the forecast band is the empirical
  80% interval of the winner's backtest residuals — measured, not assumed. Dated
  demo dataset (`energy.csv`, deterministic) included.
- **Cap 2** (see [PLAN.md](PLAN.md) § J): V9 performance & PWA update UX, V10 Data
  Studio replayable recipes — and, as a separate product decision, an optional
  generative chat behind a server-side key proxy (never an API key in the browser).

Full roadmap in [PLAN.md](PLAN.md), target analysis in
[docs/analyse-quantifai.md](docs/analyse-quantifai.md).

## Stack

Vite · React · TypeScript (strict) · Tailwind CSS v4 · react-router · i18next ·
Vitest + Testing Library · Playwright · GitHub Actions · Cloudflare Pages (wrangler).

## Development

```bash
npm ci          # install
npm run dev     # dev server
npm run test    # unit tests (Vitest)
npm run e2e     # end-to-end tests (Playwright)
npm run lint    # ESLint + npm run format:check for Prettier
npm run build   # production build (dist/)
```

Deployment runs from CI: every PR gets a preview on Cloudflare Pages, `main` deploys to
production. Required repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
(see [docs/guide-cloudflare.md](docs/guide-cloudflare.md)).

## License

[MIT](LICENSE) © Dominic Dapice

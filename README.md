# LabML

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
- **V9 (speed & comfort) — shipped**: `/ml` Lighthouse mobile score **0.77 → 0.86**
  (measured, 3-run medians) — Dexie and the whole post-load lab moved off the
  first-paint critical path, render-blocking scripts eliminated (the anti-flash
  theme boot is inlined with a CSP `sha256` hash; the SW registers from the app),
  route facades module-preloaded, and a **static HTML shell for `/ml`** whose hero
  paints as soon as the CSS arrives (React replaces it on mount — no hydration).
  Reaching ~0.9+ would take full prerendering/SSR, noted as a Cap 3 candidate.
  Plus: a **PWA update toast** (`prompt` mode — the user decides when to reload,
  and is told when offline mode is ready) and **webcam capture** for the vision
  playground (`Permissions-Policy: camera=(self)`, stream stays local, e2e-tested
  with Chromium's fake camera).
- **V10 (Data Studio 2) — shipped**: cleaning becomes **reproducible**. The exported
  recipe JSON can be **imported and replayed** on a new file (strict validation,
  unknown fields ignored so future recipes still replay); **per-column forced
  types** (numeric / categorical / text / date) steer variant merging, imputation,
  outlier clamping and date handling; and **date expansion** derives `_year`,
  `_month` and `_weekday` columns — making dates usable by the ML Lab after the
  hand-off, where they were previously dropped.

- **V11 (drift check) — shipped**: the Data Studio compares a **new batch against
  the loaded reference** — the MLOps gesture of checking that fresh data still
  looks like what a model was trained on. Schema diff (added / removed /
  re-typed columns), **PSI per column** (bins built from the reference's
  quantiles, top-10 + OTHER buckets for categories, ε-smoothed so an emptied
  bin stays finite), new / vanished categories, missing-rate shifts, and a
  severity verdict on the conventional 0.1 / 0.25 thresholds. A deterministic
  drifted demo batch (`cafe-sales-june.csv`) is included; the comparison file
  is parsed in the browser like everything else.

- **V13 (complete runs) — shipped**: the analyses launched after training now
  **survive the run**. Hyperparameter search results, the latest Shapley
  what-if explanation, discovered groups and time-series forecasts attach to
  the saved run record — they show up in the local history (with chips), on
  the stored-run page, inside the **HTML report** and in **share links**
  (v2 payloads, with point clouds downsampled so URLs stay short; v1 links
  still decode). Metrics and summaries only — never the data.

- **V14 (generalized prerender) — shipped**: every section (`/ml`, `/data`,
  `/ai`, `/ai/vision`, `/ai/chat`, `/about`) now serves a **static shell**
  whose hero paints without JavaScript: the stylesheet is inlined (the last
  render-blocking request disappears), the two latin text fonts ride inside
  it as `data:` URIs with `font-display: block` (one paint, final font — no
  swap reflow), each shell modulepreloads its own route chunk, and a header
  placeholder reserves the exact mount footprint. Measured under **real
  (devtools) throttling**, 3-run medians: `/ml` **0.86 → 0.99** (FCP = LCP ≈
  1.0 s, CLS 0.007), `/data` **1.0**. The simulated-throttling score stays
  ~0.87–0.89 by construction: on an instant localhost the observed trace
  never contains the shell paint, so the simulator attributes LCP to the
  full JS graph — documented, not hidden. The root stays the SPA fallback
  (a shell there would flash the wrong hero on dynamic routes and share
  links).

- **V15 (score a new batch) — shipped**: the production gesture that closes
  the MLOps loop. After a run, drop a **new file** and the inspected model
  scores it in the browser: predictions for every row (exportable CSV that
  keeps all original columns), and when the file carries the target column,
  an **honest test-vs-batch metrics comparison** — labels never seen in
  training are predicted but kept out of the metrics, and counted. Schema
  is validated (missing feature columns are named), a drifted demo batch
  (`iris-field.csv`) shows the drop live, and the score joins the run
  record (history, report, share links) like every other artifact.

- **V16 (imbalance & thresholds) — shipped**: on binary runs with a
  probabilistic model, the lab shows what accuracy hides. **Precision-recall
  curve** with Average Precision (the random-classifier baseline drawn in),
  **calibration curve** with the Brier score, and an **adjustable decision
  threshold priced by a cost matrix** (false alarm vs missed case) — with
  the cost-optimal cut one click away, computed by an exhaustive sweep. The
  chosen threshold and its confusion join the run record. A deterministic
  imbalanced demo (`fraud.csv`, ~9% positives) makes the lesson concrete.
  Class-weighted _training_ was deliberately left out: cost-priced
  thresholding delivers the same decision-level control without touching
  eight hand-written models.

- **V17 (Data Studio 3: joins & anomalies) — shipped**: the everyday
  enrichment gesture. **Left-join a second file** on a shared key column —
  matching is exact after trimming, so a messy key becomes a **named
  orphan**, never a silent miss; match rate, duplicate keys and unused rows
  are all reported, and the joined result **becomes the dataset** (quality
  report, recipe, drift and the ML Lab all continue from it). Plus
  **multivariate anomaly detection** as a replayable recipe step: a
  hand-written, seeded **isolation forest** (100 trees, exact c(n)
  correction) flags the odd row _combinations_ that univariate Tukey fences
  cannot see. Demo pair included (`cafe-sales.csv` + `cafe-products.csv`:
  116/118 matched, the two messy `latte` variants surface as orphans, and
  5 multivariate anomalies drop).

- **V18 (per-segment analysis) — shipped**: "where does my model fail?".
  After training, the held-out test set is **sliced by every categorical
  column** — including columns kept _out_ of the features, where proxy
  effects hide — and the inspected model's metric (accuracy or RMSE) is
  recomputed per slice, with the **delta against the overall metric**
  shown worst-first. Slices under 8 test rows are excluded and counted,
  columns are ranked by their widest gap, and the analysis joins the run
  record (history, report, share links). On the titanic demo it points
  straight at deck C and Cherbourg passengers — and at the leaked `alive`
  column, sliced despite being excluded from training.

- **V19 (persistent projects) — shipped**: an opted-in dataset now
  **survives the reload**. One click keeps the current file in the browser
  (lz-string compressed, IndexedDB — nothing ever leaves the machine, and
  share links never carry data), under an **explicit 50 MB budget**: a file
  that does not fit is refused by name with the numbers, never trimmed
  silently. Kept datasets are listed under the run history (reopen /
  forget), runs trained on a kept dataset are **linked to it** — a stored
  run offers "reopen this run's data", and retraining is identical
  (seed 42). Forgetting is explicit and immediate.

- **V20 (honest uncertainty) — shipped**: "0.82 on 178 test rows is not
  0.82". After every run, the test set is **bootstrap-resampled** (1,000
  seeded resamples, shared across models so comparisons are paired) and
  each leaderboard metric gets its **95% interval**, drawn as
  dot-and-whisker rows on a common scale. The winner-vs-baseline gap gets
  a **paired verdict in plain language** — "the gap survives resampling
  (99.8% of resamples), probably real" or "the interval crosses zero,
  possibly noise" — and the analysis joins the run record. The honest
  limits ship with the numbers: intervals measure sensitivity to the test
  draw (not training variance), tiny test sets are declined instead of
  decorated, and a wide interval is information, not a defect.

- **V21 (run comparison) — shipped**: "did my cleaning help?". Tick two
  runs in the history and open a **side-by-side diff**: feature changes
  named as +/− badges, every model's metric in an A/B/Δ table with
  oriented colors, a **plain-language read** of the best-model move, and —
  when both runs carry V20 intervals — a **cross-run verdict**: disjoint
  intervals mean the gap exceeds both uncertainties, overlapping ones
  mean it could be noise. Honesty first: runs with different targets or
  task families refuse metric deltas (the config diff still tells the
  story), and the interval note says it plainly — two runs are never
  paired, read it as an indication, not a test.

**Cap 3 is complete** (V11 drift · V13 complete runs · V14 prerender).
**Cap 4 is complete**: V15 batch scoring, V16 imbalance tools, V17
joins & anomalies and V18 per-segment analysis all shipped.
**Cap 5 is underway**: V19 persistent projects, V20 honest uncertainty
and V21 run comparison shipped; V22 (model import) remains. V12 (an
optional generative chat behind a server-side key proxy — never an API key
in the browser) stays on hold as a product decision.

Full roadmap in [PLAN.md](PLAN.md).

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

[MIT](LICENSE) © Dominic D'Apice

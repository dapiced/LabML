# LabML — Detailed Plan

> **Interactive, privacy-first ML platform** — `app.dominicdapice.com/ml`
> A personal, zero-friction Data/ML hub with its own visual identity and a visible MLOps layer.

---

## 1. Introduction — recap of the understanding

**What we are building.** A complete web application where a visitor can:

1. Drag in a CSV file (or pick a demo dataset),
2. Explore their data (types, distributions, missing values),
3. Choose a target column (or let it be detected),
4. Automatically train several models **entirely in their browser**,
5. Read a leaderboard, metrics, charts, feature importance and a natural-language interpretation,
6. Save their projects locally, export models and reports, share their results without sharing their data.

**Critical point retained: we ship a complete application, not just the shell.** The shell (layout, navigation, theme, `/ml`, `/data`, `/ai` routes) is the deliverable of Sprint 0 only. The heart of the project — and the bulk of the plan below — is the **end-to-end working ML engine**: parsing → profiling → preprocessing → multi-model training → evaluation → visualization → export. Every sprint ends with a feature a real visitor can use, not a mockup.

**Structuring constraints:**

- Domain: `app.dominicdapice.com`, path-based routing (`/ml` first, `/data` and `/ai` later).
- Infra: GitHub (code + Actions CI/CD) + Cloudflare (DNS, SSL, hosting).
- Privacy-first: no user data ever leaves the browser.
- **Bilingual French / English** from the very first version: visible language switcher, browser-language detection, remembered preference. Every UI string goes through the i18n layer — no hard-coded strings.
- **Two color themes, user's choice**: light and dark, visible toggle in the header, remembered preference (default = system preference), WCAG contrast verified in both themes (ECharts charts included).
- Responsive, accessible (WCAG), clean code (ESLint/Prettier), open-source.

---

## 2. Analysis of the reference

_Note: this synthesis is based on observing a zero-friction ML lab on the market, taken as the journey reference, plus the observations provided in the brief._

**User journey (the "flow" to match, then beat):**

| Step     | Reference behavior                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| Entry    | Drag & drop a CSV (or tabular format), read locally, **nothing is sent to a server**                                   |
| Target   | The user picks the column to predict, or ML Lab suggests it; suggestions of columns to keep/exclude                    |
| Task     | Automatic classification-vs-regression detection from the target column                                                |
| Training | A small set of models trained client-side, with a held-out test set                                                    |
| Results  | Model leaderboard, metrics **compared to a naive baseline**, charts, top features, and a natural-language "plain read" |
| Friction | Zero: no account, no setup, no code                                                                                    |

**Design/UX (the spirit to capture):** a clean, professional SaaS interface — one task per screen, guided progression (upload → target → train → results), plenty of white space, clear typographic hierarchy, results explained for non-experts.

**What makes the product strong** (and what we keep): zero friction, a verifiable privacy promise, the naive baseline as an honest point of comparison, the natural-language interpretation.

**What we will do better** (detailed in section D): visible MLOps observability, reproducibility ("pipeline as code"), persistent projects, data-free sharing, deeper interpretability, dark/light theme, offline PWA.

---

## A. Technical architecture

### A.1 Recommended stack

| Layer                       | Recommended choice                                                                                                                                            | Alternatives set aside                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework                   | **Vite + React 19 + strict TypeScript** (static SPA)                                                                                                          | Next.js (SSR is useless here: all compute is client-side; Next's static export adds complexity for no benefit), Nuxt/SvelteKit (same reason) |
| Routing                     | **React Router v7** (library mode, per-route code-splitting)                                                                                                  | TanStack Router (excellent but more niche)                                                                                                   |
| UI                          | **Tailwind CSS v4 + shadcn/ui** (components copied into the repo, customizable) + lucide-react                                                                | Material UI (visual identity too "Google", heavier bundle)                                                                                   |
| State                       | **Zustand** (light, testable)                                                                                                                                 | Redux (oversized)                                                                                                                            |
| Charts                      | **Apache ECharts** (canvas, fast on 100k+ points, tree-shakable, native zoom/filter/export)                                                                   | Plotly.js (~4 MB, too heavy for the perf budget), pure D3 (high dev cost)                                                                    |
| Parsing                     | **Papa Parse** (streaming CSV, Web Worker support)                                                                                                            | SheetJS (added in V2 for .xlsx)                                                                                                              |
| Classical ML                | **ml.js ecosystem** (ml-cart, ml-random-forest, ml-knn, ml-naivebayes, ml-regression) + hand-written TS implementations (logistic regression, histogram GBDT) | scikit-learn on a server (breaks the privacy promise)                                                                                        |
| Neural networks             | **TensorFlow.js** (MLP, WebGPU backend with WASM fallback) — V2                                                                                               | —                                                                                                                                            |
| Pre-trained model inference | **ONNX Runtime Web** (`/ai/vision` module) — V3                                                                                                               | —                                                                                                                                            |
| i18n                        | **react-i18next** (FR/EN, browser detection, lazy-loaded resources)                                                                                           | home-grown solutions (reinventing the wheel)                                                                                                 |
| Persistence                 | **Dexie.js** (IndexedDB): projects, runs, models                                                                                                              | localStorage (size limits), backend (privacy)                                                                                                |
| Sharing                     | **lz-string**: results compressed into the URL fragment (`#…`)                                                                                                | Sharing backend (optional V3)                                                                                                                |
| Hosting                     | **Cloudflare Pages** (static + CDN)                                                                                                                           | Workers Sites (pointless without server logic)                                                                                               |

### A.2 Rationale for the choices (the "why", with DevOps parallels)

- **Static SPA over full-stack.** All the value (parsing, training, visualization) runs on the client: an application server would only add cost, attack surface, and a weakened privacy promise. Infra parallel: this is the equivalent of a site served by **Azure Static Web Apps + CDN** — zero servers to patch, trivial scaling, near-zero cost.
- **Vite + React.** Fast builds, the richest JS ML/dataviz ecosystem, and the most legible skill on a portfolio. Strict TypeScript plays the role Terraform validation plays: errors are caught at "plan" time, not at "apply" time.
- **Web Workers for training.** The UI must never freeze during a fit. Each training run goes to a dedicated worker (via Comlink) that publishes progress events. Parallel: this is your job queue — the worker is a _build agent_, the UI is the orchestrator streaming the logs live.
- **ECharts over Plotly.** The performance budget (Lighthouse ≥ 95) is a stated goal; Plotly alone would blow it. ECharts provides the zoom, brush, filtering and PNG export the brief asks for, at ~1/5 of the weight with selective imports.
- **shadcn/ui over a component library.** The components live in our repo: our own visual identity (a brief requirement), no external style dependency, and a showcase of readable code.

### A.3 Architecture diagram

```
                        ┌─────────────────────────────────────────────┐
                        │           THE USER'S BROWSER                │
                        │  (all the data stays here)                  │
                        │                                             │
                        │  ┌───────────────┐   ┌────────────────────┐ │
                        │  │  React UI     │◄──┤ Web Workers        │ │
                        │  │  /ml /data /ai│   │ · parsing (Papa)   │ │
                        │  │  ECharts      │   │ · preprocessing    │ │
                        │  │  Zustand      │   │ · training         │ │
                        │  └──────┬────────┘   │   (ml.js / TF.js)  │ │
                        │         │            └────────────────────┘ │
                        │  ┌──────▼────────┐   ┌────────────────────┐ │
                        │  │ IndexedDB     │   │ URL fragment #…    │ │
                        │  │ (Dexie)       │   │ data-free sharing  │ │
                        │  │ projects/runs │   │ (never sent to     │ │
                        │  └───────────────┘   │  the server)       │ │
                        └─────────┬────────────┴────────────────────┴─┘
                                  │ HTTPS (static assets only)
                 ┌────────────────▼───────────────────┐
                 │           CLOUDFLARE               │
                 │  DNS: app.dominicdapice.com (CNAME)│
                 │  Universal SSL · CDN · _headers CSP│
                 │  Pages (static) · Workers (V3:     │
                 │  API proxy for /ai/chat)           │
                 └────────────────▲───────────────────┘
                                  │ deployment (wrangler)
                 ┌────────────────┴───────────────────┐
                 │             GITHUB                 │
                 │  LabML repo (open-source)          │
                 │  Actions: lint→type→test→build→    │
                 │  e2e→deploy (+ per-PR previews)    │
                 └────────────────────────────────────┘
```

**Key privacy point:** the share link encodes the metrics/charts (never the data) into the URL **fragment** — the part after `#` is never sent to the server by the browser. The promise "your data never leaves your machine" stays true even while sharing.

### A.4 Folder structure

```
LabML/
├── .github/workflows/          # ci.yml, deploy.yml, lighthouse.yml
├── docs/                       # ARCHITECTURE.md, adr/, user guide
├── public/
│   ├── datasets/               # demo CSVs (iris, titanic, housing…)
│   └── _headers, _redirects    # CSP + Cloudflare SPA fallback
├── src/
│   ├── app/                    # bootstrap, router, layout, theme
│   ├── components/ui/          # design system (customized shadcn/ui)
│   ├── features/
│   │   ├── ml/                 # THE HEART OF THE PRODUCT
│   │   │   ├── data/           # parsing, type inference, profiling
│   │   │   ├── pipeline/       # preprocessing, split, run config
│   │   │   ├── models/         # one module per model (shared interface)
│   │   │   ├── metrics/        # accuracy, F1, AUC, RMSE… (golden-tested)
│   │   │   ├── explain/        # importance, PDP, NL interpretation
│   │   │   ├── workers/        # training workers (Comlink)
│   │   │   ├── projects/       # Dexie persistence, export, sharing
│   │   │   └── pages/          # screens of the /ml journey
│   │   ├── data/               # V3 placeholder (data pipelines)
│   │   └── ai/                 # V2/V3 placeholder (chat, vision)
│   └── lib/                    # shared utilities
├── tests/
│   ├── e2e/                    # Playwright
│   └── golden/                 # scikit-learn reference values
└── wrangler.toml               # Cloudflare config (the .tf equivalent)
```

Each section (`/ml`, `/data`, `/ai`) is a lazily-loaded **feature folder** (per-route code-splitting): adding `/ai/vision` later touches neither the shell nor `/ml`.

---

## B. Development — phases and functional content

### B.0 Sprint 0 — Foundations (≈ 1 week) — _the shell, and nothing but the shell_

- Vite + React + strict TS scaffold, ESLint (flat config) + Prettier + Husky/lint-staged.
- Design system: tokens (colors, type, spacing), **two light/dark themes with a persisted user toggle** (default = system preference), base components.
- **i18n foundation (react-i18next)**: FR + EN from the very first screen, language switcher, browser detection, persisted preference — i18n lands in Sprint 0 because retrofitting it onto an existing app costs 10× more.
- Shell: layout, navigation, `/`, `/ml`, `/data` (coming soon), `/ai` (coming soon) pages, 404 page.
- Full CI/CD (section C) + the `app.dominicdapice.com` domain live.
- **Definition of done:** the app is deployed, Lighthouse ≥ 95, the CI pipeline blocks on lint/type/test.

### B.1 Sprint 1 — Data (≈ 1–2 weeks) — _first real user value_

- Drag & drop CSV upload (streaming Papa Parse in a worker, up to ~500 MB).
- **Built-in demo datasets** (Iris, Titanic, California Housing) → one-click trial, zero friction.
- Per-column type inference (numeric, categorical, boolean, date, text, ID).
- **Data profile**: per column — distribution (histogram/bars), % missing, cardinality, min/max/mean/median; virtualized tabular preview.
- Target selection + **automatic task detection** (binary/multi-class classification vs regression).
- Smart suggestions: exclusion of ID/constant/near-empty columns, **target-leakage warning** (a column too correlated with the target).
- **DoD:** a visitor loads a CSV and understands their data without installing anything.

### B.2 Sprint 2 — Training engine (≈ 2 weeks) — _the heart_

- Declarative preprocessing pipeline: imputation (median/mode), encoding (one-hot / ordinal depending on cardinality), standardization, all **fitted on the training split only** (no leakage).
- Stratified train/test split (80/20, fixed reproducible seed).
- **Model zoo v1** behind a shared `Trainable` interface:
  - Naive baseline (majority class / mean) — the honest point of comparison,
  - Linear / logistic regression (hand-written TS, vectorized gradient descent),
  - k-NN, Gaussian Naive Bayes,
  - Decision tree (ml-cart), Random Forest (ml-random-forest).
- Execution in **Web Workers** with live progress (current model, %, elapsed time), cancellable.
- **Live leaderboard**: rows appear as they finish, sorted by the main metric, delta vs baseline highlighted.
- Metrics: accuracy, precision/recall, F1, ROC-AUC, log-loss (classification); RMSE, MAE, R² (regression).
- **DoD:** the full upload → target → train → leaderboard journey, reproducible (same seed ⇒ same results).

### B.3 Sprint 3 — Results & insights (≈ 1–2 weeks)

- Per-model visualizations: interactive confusion matrix, ROC/PR curves, predicted-vs-actual and residuals (regression) — zoom, filter, PNG export (ECharts).
- **Feature importance**: permutation importance (model-agnostic) + impurity-based importance for trees.
- **Natural-language interpretation** generated by rules (no external API): "The Random Forest beats the baseline by 18 points. The 3 most decisive variables are…".
- **What-if prediction**: a form pre-filled with one row; the user edits values and watches the prediction change live.
- **DoD:** the results page tells a complete story to a non-expert.

### B.4 Sprint 4 — Projects, export & sharing (≈ 1 week)

- **Projects** (Dexie/IndexedDB): run history, rename, delete, side-by-side comparison of two runs.
- **Exports**: model (reloadable JSON), predictions (CSV), **self-contained HTML report** (printable to PDF via CSS print).
- **Share link**: metrics + charts compressed (lz-string) into the URL fragment; read-only page.
- **DoD:** a returning visitor finds their projects; a shared link opens without the original data.

### B.5 Sprint 5 — Quality & polish (≈ 1 week)

- WCAG AA accessibility (keyboard navigation, aria, contrast verified in both themes, axe-core in CI).
- **Offline PWA** (vite-plugin-pwa): the ultimate demo of the privacy promise — _turn off the Wi-Fi, everything still works_.
- Lighthouse budgets in CI, **full FR/EN translation review** (including the generated natural-language interpretations, produced in both languages), "How it works / Privacy" page.

### B.6 V2 / V3 — extensions (post-MVP, prioritized in section D)

- **V2:** TensorFlow.js MLP (WebGPU→WASM), hand-written TS histogram GBDT (LightGBM spirit), hyperparameter search (time-budgeted random search), approximate SHAP (sampled Kernel SHAP), PDP/ICE, .xlsx/.parquet import.
- **V3:** `/ai/vision` (ONNX Runtime Web + pre-trained models like MobileNet), `/ai/chat` (LLM via a Cloudflare Worker proxy — only the _questions and aggregated statistics_ leave, never the raw data, with explicit consent), the `/data` module, ONNX export, GitHub OAuth auth if features ever justify it.

---

## C. Continuous integration & deployment

### C.1 GitHub Actions

Two workflows (a direct parallel with your Azure DevOps pipelines):

```
ci.yml (on PRs and main)
  lint (ESLint + Prettier check)
  → typecheck (tsc --noEmit)
  → unit + golden tests (Vitest, coverage)
  → build (Vite)
  → e2e (Playwright, Chromium browser)
  → lighthouse-ci (perf/a11y budgets, non-blocking at first)

deploy.yml (after green CI)
  PR    → wrangler pages deploy --branch=<pr>   ⇒ per-PR preview URL
  main  → wrangler pages deploy                 ⇒ production
```

- Deployment via `cloudflare/wrangler-action` with `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` as GitHub secrets (the equivalent of Azure DevOps variable groups; token scoped to the single Pages project, least privilege).
- **Per-PR previews** = your ephemeral environments: every PR gets its own test URL.
- V2: CodeQL + Dependabot/Renovate — a DevSecOps showcase.

### C.2 Cloudflare (DNS, SSL, routing)

1. **Pages**: `labml` project, connected to the repo (deployment driven by Actions to keep CI in control — the "plan/apply" stays in GitHub).
2. **DNS**: `app.dominicdapice.com` as a `CNAME` to `<project>.pages.dev`, proxy enabled (orange cloud) ⇒ automatic universal SSL, CDN, HTTP/3. The apex domain stays on GitHub Pages, no interference.
3. **Path-based routing**: the **SPA router** handles `/ml`, `/data`, `/ai` — on the Cloudflare side, a simple `_redirects` fallback (`/* /index.html 200`). No Workers needed for the MVP: a routing Worker would only make sense if `/ai` ever became a separate app.
4. **`_headers`**: strict CSP and security headers (section E), served by the CDN.

---

## D. Improvements over the reference & prioritization

### D.1 The 3 "signature" improvements (the portfolio's MLOps DNA)

1. **Built-in run observability.** For every model, the leaderboard shows: training time, **p50/p95 inference latency** (measured on the test set), estimated memory, compute backend (WASM/WebGPU). A lay visitor sees scores; a recruiter sees a Grafana/App Insights reflex applied to ML. _(Sprint 2–3, low marginal cost.)_
2. **Pipeline as code + reproducibility.** Every run is defined by a **declarative config** (JSON: seed, split, preprocessing, models, hyperparameters), viewable via a "View pipeline" button, re-runnable identically, and exportable as an **equivalent scikit-learn Python script**. This is Terraform applied to ML: the run is the `apply` of a versioned plan. _(Config from Sprint 2; button + Python export in Sprint 4/V2.)_
3. **Local model registry with lineage.** Saved models carry a version, a stage (dev/staging/prod), their original config and a hash of the data schema; diff comparison between two runs and a **schema-drift alert** when a new CSV in the same project no longer matches. MLflow-like, 100% in IndexedDB. _(Sprint 4 for the base, V2 for drift.)_

### D.2 Prioritization of the brief's improvements (section 4 of the prompt)

| Requested improvement                                | Priority           | Where                                   |
| ---------------------------------------------------- | ------------------ | --------------------------------------- |
| Interactive charts (zoom, filter, export)            | **MVP**            | Sprints 1–3 (ECharts)                   |
| Project management (local history)                   | **MVP**            | Sprint 4 (IndexedDB)                    |
| Data-free sharing                                    | **MVP**            | Sprint 4 (URL fragment)                 |
| Model export (JSON) + reports (HTML/PDF)             | **MVP**            | Sprint 4                                |
| Light/dark theme, user's choice                      | **MVP** (hard req) | Sprint 0                                |
| Bilingual FR/EN interface                            | **MVP** (hard req) | Sprints 0 → 5                           |
| Smooth animations, WCAG                              | **MVP**            | Sprints 0 + 5                           |
| Simplified interpretability (importance, plain read) | **MVP**            | Sprint 3                                |
| Neural networks (TensorFlow.js)                      | V2                 | MLP after the classical zoo             |
| Boosted models (XGBoost/LightGBM spirit)             | V2                 | hand-written TS GBDT; WASM port to eval |
| Approximate SHAP/LIME, PDP/ICE                       | V2                 | after permutation importance            |
| AutoML + hyperparameters                             | V2                 | budgeted random search                  |
| ONNX / PMML export                                   | V3                 | non-trivial in the browser, revisit     |
| AI chat over the data                                | V3                 | Worker proxy + explicit consent         |
| Computer vision                                      | V3                 | ONNX Runtime Web, `/ai/vision`          |
| Authentication                                       | V3                 | only if a real need emerges             |

**Prioritization logic:** the MVP must beat the reference on its own turf (tabular journey + trust + persistence + sharing) before widening the surface. Every V2/V3 item is an independent brick thanks to the feature-folder split.

---

## E. Security & privacy

- **The "data never leaves the browser" guarantee, verifiable:**
  - Strict CSP via `_headers`: `default-src 'self'` — the browser _forbids_ any network call to third parties; fonts and assets self-hosted. The promise is not marketing copy, it is **observable in the Network tab** (and the Privacy page will say exactly that).
  - No telemetry by default; at most, Cloudflare Web Analytics (cookie-less, aggregated) — and only if you decide so.
  - Offline PWA = proof by usage.
- **Headers**: `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`; COOP/COEP only if we enable WASM multithreading (SharedArrayBuffer) in V2.
- **API keys**: none in the client, ever. The future `/ai/chat` will go through a **Cloudflare Worker proxy** that holds the key (Wrangler secret), applies rate-limiting, and only relays consented aggregates.
- **Supply chain**: committed lockfile, Dependabot/Renovate, `npm audit` in CI, CodeQL (V2), minimal GitHub Actions permissions (`permissions: contents: read` by default).

## F. Tests & quality

- **Unit (Vitest)**: critical components + the entire `metrics/`, `pipeline/`, `models/` layer.
- **Golden tests** — the centerpiece for a hand-written ML engine: a Python script (run outside CI, fixtures committed) computes **scikit-learn** reference values (metrics, predictions of simple fixed-seed models); Vitest checks that our TS implementation reproduces those values within tolerance. This is our scientific non-regression contract.
- **Property-based (fast-check)**: CSV parsing (encodings, quotes, malformed lines), metric invariants (bounds, symmetries).
- **E2E (Playwright)**: the full journey — load Titanic, pick `survived`, train, check the leaderboard, export the report, reload the page and find the project again.
- **Performance**: Lighthouse CI with budgets (perf ≥ 95, a11y ≥ 95, initial bundle < 200 KB gz — ML libs lazy-loaded at the first training).
- **A11y**: axe-core integrated into the e2e suite.

## G. Documentation & maintenance

- **README**: pitch, screenshot, CI badges, 3-command quickstart.
- **docs/ARCHITECTURE.md** + **ADRs** (`docs/adr/`): every structuring choice recorded (framework, ECharts, ML engine…) — the RFC/design-doc reflex teams expect from a tech lead.
- **Built-in user guide** inside the app (a "How it works" page) rather than an external wiki.
- **Maintenance**: Renovate (weekly grouped updates), CHANGELOG with semantic versioning, light monitoring (Cloudflare Analytics + an error boundary with an error report the user can _copy manually_ — no automatic sending, consistent with privacy).

---

## H. Framing decisions

**Decisions validated on 20/08/2026:**

| #   | Decision           | Validated choice                                                                                       |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| 1   | Framework          | **Vite + React + TypeScript** (static SPA)                                                             |
| 2   | UI / design system | **Tailwind CSS v4 + shadcn/ui**                                                                        |
| 3   | ML execution (MVP) | **100% in the browser** (Azure reserved for V3 extensions)                                             |
| 4   | Deployment         | **GitHub Actions + wrangler** (per-PR previews)                                                        |
| 5   | Languages          | **Bilingual FR/EN** from Sprint 0 (addendum)                                                           |
| 6   | Themes             | **Light + dark, user's choice** (addendum)                                                             |
| 7   | Palette            | **Deep teal + copper accent — no yellow/amber** (an identity deliberately distinct from the reference) |

**Still-open questions (non-blocking for Sprint 0):**

1. **Default language** when the browser reports neither FR nor EN (recommended: English, for the portfolio's international reach).
2. **Cloudflare access**: create the Pages project + API token on your side (step-by-step guide provided in Sprint 0), or validate first on `*.pages.dev` before wiring the DNS?

## I. Concrete next steps

1. **You**: validate/amend the answers to questions H1–H6.
2. **Me**: Sprint 0 — full scaffold + design system + shell + CI/CD (dedicated PR, with preview).
3. **You**: create the Cloudflare Pages project + token (guide provided), add the 2 GitHub secrets.
4. **Me**: Sprints 1 → 2 right after — the app becomes a _real_ ML Lab (upload → profiling → training → leaderboard), then Sprints 3 → 5.
5. Joint review at the end of every sprint on the preview URL.

---

## J. Cap 2 — post-V6 improvement plan (21/08/2026)

**Recap**: everything this plan promised is delivered and verified in production —
S0–S5 (complete MVP), V2 (GBDT + MLP + PDP + Excel), V3 (ONNX vision), V4 (Data
Studio), V5 (hyperparameter search + Shapley), V6 (FR/EN data assistant).
12 PRs merged, 152 unit tests, 32 e2e, WCAG AA, offline PWA.

Cap 2 prioritizes what raises the product's value the most while honoring the
invariants (100% in the browser, strict CSP with no third parties, seeded
determinism, FR/EN, WCAG AA, honest evaluation):

| Wave   | Content                                                                                                                                                                                                                                                                                                                 | Why                                                                                               |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **V7** | **Unsupervised exploration** in the ML Lab: hand-written k-means (seeded k-means++ init, k ∈ 2–5 chosen by silhouette), hand-written 2D PCA projection (power iteration), plain-language group profiles, scatter plot with colors **and shapes** (palette validated for color blindness by the design-system validator) | Fills the real gap: today the lab requires a target; many datasets are explored first without one |
| V8     | **Time series**: date + numeric target detection → trend/season decomposition, hand-written Holt-Winters forecasting, rolling-origin backtest                                                                                                                                                                           | Opens up an entire class of problems                                                              |
| V9     | **Performance & comfort**: /ml Lighthouse budget ≥ 0.90 (preloads, splitting), PWA update toast, webcam for vision (Permissions-Policy to open)                                                                                                                                                                         | Perceived quality and scores                                                                      |
| V10    | **Data Studio 2**: importable recipe replayable on a new file, per-column forced types, derived columns                                                                                                                                                                                                                 | Completes the reproducibility loop                                                                |
| —      | **Generative chat** (optional, outside the cap): requires a server proxy (Cloudflare Worker) + a key provided by the owner — never a key in the browser; mandatory consent screen                                                                                                                                       | A product decision to make separately                                                             |

---

## K. Cap 3 — post-V10 improvement plan (21/08/2026)

**Cap 2 recap**: V7 (unsupervised exploration), V8 (time series), V9 (speed &
comfort, /ml 0.77 → 0.86 measured), V10 (replayable recipes, forced types,
derived dates) — delivered and verified in production. 16 PRs merged,
177 unit tests, 36 e2e.

| Wave                | Content                                                                                                                                                                                                                                                                                                                                                                                          | Why                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| **V11 — delivered** | **Data drift** in the Data Studio: a reference file, a file to compare → schema differences (columns added/removed/retyped), **PSI per column** (quantile bins from the reference, thresholds 0.1/0.25), new/vanished categories, missing-rate gaps, overall verdict — with a deliberately drifted demo (`cafe-sales-june.csv`)                                                                  | The MLOps gesture par excellence: checking that a new batch looks like what the model learned on |
| V12 — pending       | **Consented generative chat**: a Cloudflare Pages Function (same repo) proxying the Anthropic API — the key lives in a Cloudflare secret, never in the browser; the LLM translates the question into an intent executed **locally** by the V6 engine (only the question and the column schema leave, never the data); explicit consent screen; clean degradation if the secret is not configured | Owner's product decision (21/08/2026): postponed for now                                         |
| **V13 — delivered** | **Complete runs**: tuning, latest Shapley explanation, exploration and forecast attached to the run record — IndexedDB history (with chips), stored-run page, HTML report and v2 share links (subsampled scatter plots in the URL; v1 links remain decodable)                                                                                                                                    | The V5–V8 artifacts did not survive the run                                                      |
| **V14 — delivered** | **Generalized prerendering**: static shells for all six sections (the V9 approach extended — inlined CSS, Latin fonts as data:, per-route preloaded façade, header template), Lighthouse /ml 0.86 → 0.99 and /data 1.0 under real throttling (3-run medians); the root stays the SPA fallback (accepted)                                                                                         | The last Lighthouse gap                                                                          |

---

## L. Cap 4 — post-Cap 3 improvement plan (21/08/2026)

**Cap 3 recap**: V11 (drift), V13 (complete runs), V14 (generalized
prerendering, /ml 0.99 under real throttling) — delivered and verified in
production. V12 (consented generative chat) remains pending a product
decision. Cap 4's guiding thread: the next gesture — using the model
over time, and understanding it more finely.

| Wave                | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Why                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **V15 — delivered** | **Score a new batch**: after a run, drop a new file → the inspected model scores it in the browser (exportable predictions, all columns preserved); if the target is present, honest test-vs-batch comparison (unknown labels excluded and counted); schema validated, drifted demo `iris-field.csv`, score attached to the run (history/report/share)                                                                                                                                                                                          | The complete MLOps loop: V11 says "the inputs moved", V15 says "does the model still hold" |
| **V16 — delivered** | **Imbalance & thresholds**: precision-recall curve (AP, chance line drawn), adjustable decision threshold priced by a cost matrix (false alarm vs missed case, one-click optimum), calibration curve (Brier), imbalanced demo `fraud.csv`; the chosen threshold joins the run. Accepted descope: class weighting at training time is set aside — the cost-priced threshold gives the same control at the decision level, without touching the eight hand-written models                                                                         | Real datasets are imbalanced; accuracy lies there                                          |
| **V17 — delivered** | **Data Studio 3: joins & anomalies**: left join of a second file on a shared key (exact match after trim — a dirty key becomes a named orphan, never silence; match rate, duplicates, unused rows; the joined result becomes THE dataset), and **multivariate anomalies** via a hand-written seeded isolation forest (100 trees, exact c(n)) as a step of the **replayable recipe** (threshold 0.6). Accepted nuance: the join is an ingestion gesture, not a recipe step — replaying a recipe only requires a single file                      | Real data prep starts by crossing two files; multivariate anomalies see what Tukey misses  |
| **V18 — delivered** | **Per-segment analysis**: after a run, the test set is sliced by every categorical column — including those excluded from the features, where proxy effects hide — and the inspected model's metric (accuracy or RMSE) is recomputed per slice, gap vs global signed and sorted worst-first. Slices < 8 rows set aside and counted, columns ranked by amplitude (cap 6×8), analysis attached to the run (history/report/share). On titanic it points at deck C, Cherbourg — and the `alive` column, sliced despite being excluded from training | "Where does my model fail?" — an honest gateway to fairness                                |

**Cap 4 closed (21/08/2026)**: V15, V16, V17 and V18 delivered and verified.
Only V12 remains pending a product decision. The "Where the build stands"
section of /ml was removed the same day (owner request) — the wave history
lives here and in the README.

## M. Cap 5 — post-Cap 4 improvement plan (21/08/2026)

**Cap 4 recap**: V15 (batch scoring), V16 (imbalance & thresholds), V17
(joins & anomalies), V18 (per-segment analysis) — delivered and verified
in production on 21/08/2026. Cap 5's guiding thread: the complete project —
it survives, it measures itself, it compares itself, it gets reused.

| Wave                | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Why                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **V19 — delivered** | **Persistent projects**: the dataset joins the project, opt-in ("keep in this browser") — lz-string-compressed CSV in IndexedDB, explicit 50 MB budget (named refusal with the numbers, never a silent cut), saved list (reopen/forget) under the history, runs linked to the saved dataset ("reopen this run's data"), identical retraining (seed 42). Nothing in the share links                                                                                                                                                                                           | A refresh erased everything; "projects" are only real if they survive |
| **V20 — delivered** | **Honest uncertainty**: seeded bootstrap of the test set (1,000 resamples shared across models — paired comparisons) → percentile 95% CI on every leaderboard model's main metric (whiskers on a shared scale), plain-language paired winner-vs-baseline verdict ("the gap survives resampling — probably real" / "the interval crosses zero — possibly noise"), analysis attached to the run (history/report/share). Limits owned and displayed: the CI measures sensitivity to the test draw, not training variance; test set < 8 rows → refusal, no theater               | `0.82` on 178 rows is not `0.82`; say what the number does not say    |
| **V21 — delivered** | **Compare two runs**: check two runs in the history → side-by-side diff on /ml/compare — features added/removed as ± badges, every model's metric in an A/B/Δ table (signed colors), plain-language read of the best model's movement, and a cross-run verdict when both runs carry V20 CIs (disjoint → the gap exceeds both uncertainties; overlapping → possibly noise). Honesty: different targets or task families → metric deltas refused (the config diff remains); owned note: two runs are never paired — an indication, not a test                                  | "Did my cleaning help?" — the central iterative gesture of ML         |
| **V22 — delivered** | **The model comes back**: export as format v2 — the JSON embeds the fitted pipeline (imputation/encoding/standardization), the target, the classes and the exporting run's test metrics as an honest reference. Re-imported on /ml, LabML rebuilds the EXACT predictor (every exportable family round-trips byte-identically — GBDT with its bin edges, MLP, trees/forests via ml.js) and scores any CSV without retraining; named refusals (unknown app, v1 format, missing columns, unknown family). k-NN always refuses to export: its "parameters" are the training data | Closes the last loop: train today, come back in a month, score        |

**Cap 5 closed (21/08/2026)**: V19, V20, V21 and V22 delivered.

Set aside for now (possible Cap 6): **Vision 2** — a stronger model than a
2012 SqueezeNet, or real face/object detection, still 100% in the browser
(owner request, 21/08/2026: portraits have no ImageNet class and the model
answers off-target); text columns (hand-written TF-IDF), learning curves,
scaling to 1M rows (typed arrays), multiclass thresholds. V12 remains
pending a product decision.

## N. Cap 6 — post-Cap 5 future improvement plan (xx/xx/2026) TODO

**Cap 5 recap**: V19 (persistent projects), V20 (honest uncertainty), V21
(run comparison), V22 (model export/import) — delivered and verified in
production on 21/08/2026. Cap 6's guiding thread: the lab meets the real
world — real photos, real text, real file sizes, and the question every
data budget asks.

| Wave                | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Why                                                                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V23 — delivered** | **Vision 2**: SqueezeNet (2012) retired for three self-hosted ONNX models — **EfficientNet-Lite4 int8** classification (1,000 ImageNet classes, 77.6% top-1), **YOLOX-Nano** object detection (80 COCO classes; the stronger-but-AGPL YOLOs were ruled out, Apache-2.0 kept) and **UltraFace RFB-320** face detection — boxes drawn on the image, FR/EN class names, plain-language counts ("1 person · 1 face"). Box decoding (grids/strides, exp, IoU, per-class NMS) is hand-written and unit-tested; letterboxed inputs (aspect squashing measurably mislocated face boxes); named thresholds (objects 35%; faces 0.9 — real faces score ≥ 0.95, measured false positives top out at 0.85); ~19 MB total, runtime-cached, offline after first use; verified on real photos (NASA portrait → 1 person + 1 face; German Shepherd → dog + breed at 99.9%)                                                                                                                                                                                                                                                                             | Owner request (21/08/2026): portraits have no ImageNet class, so the old model answered off-target — and the detector must recognize a whole range of things, not just faces                                                        |
| **V24 — delivered** | **Text columns**: free text stops being skipped and enters the pipeline as a hand-written **TF-IDF** block — accent-folding bilingual tokenizer, merged FR/EN stop words, vocabulary capped at 256 terms ranked by document frequency (ties alphabetical, terms seen in a single training document dropped), smoothed IDF, L2-normalized vectors, fitted on the training split only. Features are named `column:word`, so importance, Shapley and the report speak in words; `encodedBlocks` now measures a text block by its real width (counting it as one column silently shifted every block after it). Explanations gained **signed word effects** by occlusion — erase one word from the reviews containing it and average the shift of the answer — because permutation is blind to a redundant vocabulary, and multiclass is refused rather than faked. Export bumped to **format v3** (v2 files still import). Demo `reviews.csv`: 240 bilingual orders where the text carries the signal — baseline 0.52 → 0.92, `review` top of the importance chart, `fast`/`excellent`/`avance` pushing up, `refund`/`cheap` pushing down | Real CSVs have text columns (comments, descriptions) — the lab used to drop them on the floor                                                                                                                                       |
| V25                 | **Scale**: comfortable at 100k–1M rows — typed-array pipeline, streaming profiling, **announced** seeded sampling (never silent), named memory guards, before/after measurements published                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | The lab targets real files, but chokes past ~50k rows today                                                                                                                                                                         |
| V26                 | **Learning curves**: "would more data help?" — train on growing seeded fractions of the data, plot metric vs training size with V20 bootstrap intervals, plain-language verdict (plateau vs still climbing)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Closes the classic budget question: collect more data, or work on the model                                                                                                                                                         |
| V27                 | **Local chat, upgraded**: a small language model running entirely in the browser (WebGPU with WASM fallback, self-hosted quantized weights, loaded on demand behind an explicit size warning) to understand free-form questions — it only _interprets_; the V6 deterministic engine still does all the math on the data, and the current interpreter remains the clean fallback when the device cannot run the model                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Owner request (21/08/2026): the rule-based assistant understands narrow phrasings; a local LM widens them without breaking "no server, no key"                                                                                      |
| V28                 | **Analytical SQL (DuckDB-Wasm)**: embed DuckDB-Wasm (MIT) as a client-side OLAP engine in the Data Studio — a SQL console over the active dataset (registered through `registerFileBuffer`) and over dropped CSV / **Parquet** / JSON files (Parquet would be a new input format for the lab), results as Arrow → virtualized table + CSV export, one click to hand a query result to the ML Lab. LabML's rules bend the stock recipe: the worker and WASM bundles are **self-hosted** under `/duckdb/` (the strict CSP forbids the jsDelivr CDN the docs default to — same pattern as `/ort/`), runtime-cached (offline after first use); the **single-threaded fallback is the assumed mode** (no COOP/COEP headers, same posture as ONNX Runtime — SharedArrayBuffer stays off); **local files only** — remote S3/HTTP querying stays out: the CSP blocks it and the privacy promise wants it out                                                                                                                                                                                                                                   | Owner request (21/08/2026): real analytical SQL — joins, window functions, aggregations on ~100 MB files — with zero backend; and a natural V27 pairing (a local LM compiling questions to SQL, executed by a deterministic engine) |

**Ordering**: V23 first (owner request); V24 keeps its vocabulary capped
until V25 strengthens the underlying machinery (typed arrays, memory
guards), then can widen. Set aside for now: multiclass thresholds. V12
(consented generative chat) remains pending a product decision — no wave
starts without an explicit launch command.

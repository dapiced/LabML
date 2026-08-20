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
- **Next**: projects & sharing (local history, exports, data-free share links).

Full roadmap in [PLAN.md](PLAN.md), target analysis in
[docs/analyse-le site de référence.md](docs/analyse-le site de référence.md).

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

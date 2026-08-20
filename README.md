# LabML

[![CI](https://github.com/dapiced/LabML/actions/workflows/ci.yml/badge.svg)](https://github.com/dapiced/LabML/actions/workflows/ci.yml)

**EN** — A privacy-first machine learning lab that runs entirely in your browser: drop a CSV,
pick a target, train and compare models — your data never leaves your machine.
**FR** — Un laboratoire de machine learning privacy-first qui tourne entièrement dans votre
navigateur : déposez un CSV, choisissez une cible, entraînez et comparez des modèles — vos
données ne quittent jamais votre machine.

Deployed at **https://app.dominicdapice.com** (`/ml` — ML Lab; `/data` and `/ai` planned).

## Status

Sprint 0 — foundations: design system (dual light/dark theme, teal + copper palette),
bilingual FR/EN interface, path-based routing shell, CI/CD to Cloudflare Pages.
Next: the data engine (upload, profiling, target selection), then the in-browser training
engine and leaderboard. Full roadmap in [PLAN.md](PLAN.md), target analysis in
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

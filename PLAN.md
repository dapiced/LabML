# LabML — Plan détaillé

> **Plateforme ML interactive et privacy-first** — `app.dominicdapice.com/ml`
> Inspirée de QuantifAI ML Lab, repensée comme hub personnel Data/ML avec une identité propre et une couche MLOps visible.

---

## 1. Introduction — récapitulatif de la compréhension

**Ce qu'on construit.** Une application web complète où un visiteur peut :

1. Glisser un fichier CSV (ou choisir un dataset de démonstration),
2. Explorer ses données (types, distributions, valeurs manquantes),
3. Choisir une colonne cible (ou la laisser détecter),
4. Entraîner automatiquement plusieurs modèles **entièrement dans son navigateur**,
5. Lire un leaderboard, des métriques, des graphiques, l'importance des features et une interprétation en langage naturel,
6. Sauvegarder ses projets localement, exporter modèles et rapports, partager ses résultats sans partager ses données.

**Point critique retenu : on livre une application complète, pas juste le contenant.** Le shell (layout, navigation, thème, routes `/ml`, `/data`, `/ai`) est le livrable du Sprint 0 uniquement. Le cœur du projet — et l'essentiel du plan ci-dessous — est le **moteur ML fonctionnel de bout en bout** : parsing → profilage → préprocessing → entraînement multi-modèles → évaluation → visualisation → export. Chaque sprint se termine par une fonctionnalité utilisable par un vrai visiteur, pas par une maquette.

**Contraintes structurantes :**

- Domaine : `app.dominicdapice.com`, routage par chemins (`/ml` d'abord, `/data` et `/ai` ensuite).
- Infra : GitHub (code + Actions CI/CD) + Cloudflare (DNS, SSL, hébergement).
- Privacy-first : aucune donnée utilisateur ne quitte le navigateur.
- **Bilingue français / anglais** dès la première version : sélecteur de langue visible, détection de la langue du navigateur, préférence mémorisée. Toute chaîne de l'UI passe par la couche i18n — aucune chaîne en dur.
- **Deux thèmes de couleur au choix de l'utilisateur** : clair et sombre, bascule visible dans l'en-tête, préférence mémorisée (défaut = préférence système), contrastes WCAG vérifiés dans les deux thèmes (graphiques ECharts inclus).
- Responsive, accessible (WCAG), code propre (ESLint/Prettier), open-source.

---

## 2. Analyse de la cible (QuantifAI)

*Note de transparence : l'accès direct à `app.quantifai.co` est bloqué par la politique réseau de l'environnement d'analyse. Cette synthèse s'appuie sur les sources web publiques ([quantifai.co](https://quantifai.co/), [LinkedIn](https://www.linkedin.com/company/quantifaico)) et sur les observations fournies dans le brief.*

**Parcours utilisateur (le "flow" à égaler puis dépasser) :**

| Étape | Comportement QuantifAI |
|---|---|
| Entrée | Drag & drop d'un CSV (ou format tabulaire), lu localement, **rien n'est envoyé au serveur** |
| Cible | L'utilisateur choisit la colonne à prédire, ou ML Lab la propose ; suggestions de colonnes à conserver/exclure |
| Tâche | Détection automatique classification vs régression depuis la colonne cible |
| Entraînement | Petit ensemble de modèles entraînés côté client, avec un jeu de test mis de côté (holdout) |
| Résultats | Leaderboard des modèles, métriques **comparées à une baseline naïve**, graphiques, top features, et une lecture en langage naturel ("plain read") |
| Friction | Zéro : pas de compte, pas de setup, pas de code |

**Design/UX (esprit à capturer) :** interface SaaS épurée et professionnelle — une seule tâche par écran, progression guidée (upload → cible → train → résultats), beaucoup d'espace blanc, hiérarchie typographique claire, résultats vulgarisés pour non-experts.

**Ce qui fait la force du produit** (et qu'on garde) : la friction zéro, la promesse privacy vérifiable, la baseline naïve comme point de comparaison honnête, l'interprétation en langage naturel.

**Ce qu'on fera mieux** (détail en section D) : observabilité MLOps visible, reproductibilité ("pipeline as code"), projets persistants, partage sans données, interprétabilité plus poussée, thème sombre/clair, PWA hors-ligne.

---

## A. Architecture technique

### A.1 Stack recommandé

| Couche | Choix recommandé | Alternatives écartées |
|---|---|---|
| Framework | **Vite + React 19 + TypeScript strict** (SPA statique) | Next.js (SSR inutile ici : tout le calcul est client ; l'export statique de Next ajoute de la complexité sans bénéfice), Nuxt/SvelteKit (même raison) |
| Routage | **React Router v7** (mode librairie, code-splitting par route) | TanStack Router (excellent mais plus niche) |
| UI | **Tailwind CSS v4 + shadcn/ui** (composants copiés dans le repo, personnalisables) + lucide-react | Material UI (identité visuelle trop "Google", bundle plus lourd) |
| État | **Zustand** (léger, testable) | Redux (surdimensionné) |
| Graphiques | **Apache ECharts** (canvas, performant sur 100k+ points, tree-shakable, zoom/filtre/export natifs) | Plotly.js (~4 Mo, lourd pour le budget perf), D3 pur (coût de dev élevé) |
| Parsing | **Papa Parse** (CSV en streaming, supporte les Web Workers) | SheetJS (ajouté en V2 pour .xlsx) |
| ML classique | **Écosystème ml.js** (ml-cart, ml-random-forest, ml-knn, ml-naivebayes, ml-regression) + implémentations TS maison (régression logistique, GBDT histogramme) | scikit-learn côté serveur (casse la promesse privacy) |
| Réseaux de neurones | **TensorFlow.js** (MLP, backend WebGPU avec repli WASM) — V2 | — |
| Inférence modèles pré-entraînés | **ONNX Runtime Web** (module `/ai/vision`) — V3 | — |
| i18n | **react-i18next** (FR/EN, détection navigateur, lazy loading des ressources) | solutions maison (réinventer la roue) |
| Persistance | **Dexie.js** (IndexedDB) : projets, runs, modèles | localStorage (limites de taille), backend (privacy) |
| Partage | **lz-string** : résultats compressés dans le fragment d'URL (`#…`) | Backend de partage (V3 optionnel) |
| Hébergement | **Cloudflare Pages** (statique + CDN) | Workers Sites (inutile sans logique serveur) |

### A.2 Justification des choix (le "pourquoi", avec parallèles DevOps)

- **SPA statique plutôt que full-stack.** Toute la valeur (parsing, entraînement, visualisation) s'exécute chez le client : un serveur applicatif n'apporterait que des coûts, une surface d'attaque et une promesse privacy affaiblie. Parallèle infra : c'est l'équivalent d'un site servi par **Azure Static Web Apps + CDN** — zéro serveur à patcher, scaling trivial, coût quasi nul.
- **Vite + React.** Build rapide, écosystème ML/dataviz JS le plus riche, et la compétence la plus lisible sur un portfolio. TypeScript strict joue le rôle que joue la validation Terraform : les erreurs sont attrapées au "plan", pas à l'"apply".
- **Web Workers pour l'entraînement.** L'UI ne doit jamais geler pendant un fit. Chaque entraînement part dans un worker dédié (via Comlink) qui publie des événements de progression. Parallèle : c'est votre file de jobs — le worker est un *agent de build*, l'UI est l'orchestrateur qui affiche les logs en temps réel.
- **ECharts plutôt que Plotly.** Le budget performance (Lighthouse ≥ 95) est un objectif affiché ; Plotly seul le ferait exploser. ECharts offre zoom, brush, filtrage et export PNG demandés dans le brief, pour ~1/5 du poids en imports sélectifs.
- **shadcn/ui plutôt qu'une lib de composants.** Les composants vivent dans notre repo : identité visuelle propre (exigence du brief), pas de dépendance de style externe, et une vitrine de code lisible.

### A.3 Schéma d'architecture

```
                        ┌─────────────────────────────────────────────┐
                        │      NAVIGATEUR DE L'UTILISATEUR            │
                        │  (toutes les données restent ici)           │
                        │                                             │
                        │  ┌───────────────┐   ┌────────────────────┐ │
                        │  │  UI React     │◄──┤ Web Workers        │ │
                        │  │  /ml /data /ai│   │ · parsing (Papa)   │ │
                        │  │  ECharts      │   │ · préprocessing    │ │
                        │  │  Zustand      │   │ · entraînement     │ │
                        │  └──────┬────────┘   │   (ml.js / TF.js)  │ │
                        │         │            └────────────────────┘ │
                        │  ┌──────▼────────┐   ┌────────────────────┐ │
                        │  │ IndexedDB     │   │ Fragment d'URL #…  │ │
                        │  │ (Dexie)       │   │ partage sans donnée│ │
                        │  │ projets/runs  │   │ (jamais transmis   │ │
                        │  └───────────────┘   │  au serveur)       │ │
                        └─────────┬────────────┴────────────────────┴─┘
                                  │ HTTPS (assets statiques uniquement)
                 ┌────────────────▼───────────────────┐
                 │           CLOUDFLARE               │
                 │  DNS: app.dominicdapice.com (CNAME)│
                 │  SSL universel · CDN · _headers CSP│
                 │  Pages (statique) · Workers (V3:   │
                 │  proxy API pour /ai/chat)          │
                 └────────────────▲───────────────────┘
                                  │ déploiement (wrangler)
                 ┌────────────────┴───────────────────┐
                 │             GITHUB                 │
                 │  Repo LabML (open-source)          │
                 │  Actions: lint→type→test→build→    │
                 │  e2e→deploy (+ previews par PR)    │
                 └────────────────────────────────────┘
```

**Point clé privacy :** le lien de partage encode les métriques/graphiques (jamais les données) dans le **fragment** d'URL — la partie après `#` n'est jamais envoyée au serveur par le navigateur. La promesse "vos données ne quittent pas votre machine" reste vraie même en partageant.

### A.4 Structure de dossiers

```
LabML/
├── .github/workflows/          # ci.yml, deploy.yml, lighthouse.yml
├── docs/                       # ARCHITECTURE.md, adr/, guide utilisateur
├── public/
│   ├── datasets/               # CSV de démo (iris, titanic, housing…)
│   └── _headers, _redirects    # CSP + fallback SPA Cloudflare
├── src/
│   ├── app/                    # bootstrap, routeur, layout, thème
│   ├── components/ui/          # design system (shadcn/ui personnalisé)
│   ├── features/
│   │   ├── ml/                 # LE CŒUR DU PRODUIT
│   │   │   ├── data/           # parsing, inférence de types, profilage
│   │   │   ├── pipeline/       # préprocessing, split, config de run
│   │   │   ├── models/         # un module par modèle (interface commune)
│   │   │   ├── metrics/        # accuracy, F1, AUC, RMSE… (golden-testés)
│   │   │   ├── explain/        # importance, PDP, interprétation NL
│   │   │   ├── workers/        # workers d'entraînement (Comlink)
│   │   │   ├── projects/       # persistance Dexie, export, partage
│   │   │   └── pages/          # écrans du parcours /ml
│   │   ├── data/               # placeholder V3 (pipelines data)
│   │   └── ai/                 # placeholder V2/V3 (chat, vision)
│   └── lib/                    # utilitaires partagés
├── tests/
│   ├── e2e/                    # Playwright
│   └── golden/                 # valeurs de référence scikit-learn
└── wrangler.toml               # config Cloudflare (l'équivalent du .tf)
```

Chaque section (`/ml`, `/data`, `/ai`) est un **feature folder** chargé paresseusement (code-splitting par route) : ajouter `/ai/vision` plus tard ne touche ni au shell ni à `/ml`.

---

## B. Développement — phases et contenu fonctionnel

### B.0 Sprint 0 — Fondations (≈ 1 semaine) — *le contenant, et rien que lui*

- Scaffold Vite + React + TS strict, ESLint (flat config) + Prettier + Husky/lint-staged.
- Design system : tokens (couleurs, typo, espacements), **deux thèmes clair/sombre avec bascule utilisateur persistée** (défaut = préférence système), composants de base.
- **Fondation i18n (react-i18next)** : FR + EN dès le premier écran, sélecteur de langue, détection navigateur, préférence persistée — l'i18n se pose au Sprint 0 car le rétrofit sur une app existante coûte 10× plus cher.
- Shell : layout, navigation, pages `/`, `/ml`, `/data` (à venir), `/ai` (à venir), page 404.
- CI/CD complet (section C) + domaine `app.dominicdapice.com` en ligne.
- **Definition of done :** l'app est déployée, Lighthouse ≥ 95, le pipeline CI bloque lint/type/test.

### B.1 Sprint 1 — Données (≈ 1–2 semaines) — *première vraie valeur utilisateur*

- Upload drag & drop CSV (Papa Parse en streaming dans un worker, jusqu'à ~500 Mo).
- **Datasets de démo intégrés** (Iris, Titanic, California Housing) → essai en un clic, friction zéro comme QuantifAI.
- Inférence de types par colonne (numérique, catégoriel, booléen, date, texte, ID).
- **Profil de données** : par colonne — distribution (histogramme/barres), % manquants, cardinalité, min/max/moyenne/médiane ; aperçu tabulaire virtualisé.
- Sélection de la cible + **détection automatique de la tâche** (classification binaire/multi-classes vs régression).
- Suggestions intelligentes : exclusion des colonnes ID/constantes/quasi-vides, **alerte de fuite de cible** (colonne trop corrélée à la cible).
- **DoD :** un visiteur charge un CSV et comprend ses données sans rien installer.

### B.2 Sprint 2 — Moteur d'entraînement (≈ 2 semaines) — *le cœur*

- Pipeline de préprocessing déclaratif : imputation (médiane/mode), encodage (one-hot / ordinal selon cardinalité), standardisation, tout **appris sur le train uniquement** (pas de fuite).
- Split train/test stratifié (80/20, seed fixe reproductible).
- **Zoo de modèles v1** derrière une interface commune `Trainable` :
  - Baseline naïve (classe majoritaire / moyenne) — le point de comparaison honnête,
  - Régression linéaire / logistique (TS maison, descentes de gradient vectorisées),
  - k-NN, Naive Bayes gaussien,
  - Arbre de décision (ml-cart), Random Forest (ml-random-forest).
- Exécution dans des **Web Workers** avec progression temps réel (modèle en cours, % , temps écoulé), annulable.
- **Leaderboard temps réel** : les lignes apparaissent au fur et à mesure, triées par métrique principale, delta vs baseline mis en évidence.
- Métriques : accuracy, précision/rappel, F1, ROC-AUC, log-loss (classif) ; RMSE, MAE, R² (régression).
- **DoD :** parcours complet upload → cible → train → leaderboard, reproductible (même seed ⇒ mêmes résultats).

### B.3 Sprint 3 — Résultats & insights (≈ 1–2 semaines)

- Visualisations par modèle : matrice de confusion interactive, courbes ROC/PR, prédit-vs-réel et résidus (régression) — zoom, filtre, export PNG (ECharts).
- **Importance des features** : permutation importance (agnostique au modèle) + importance par impureté pour les arbres.
- **Interprétation en langage naturel** générée par règles (pas d'API externe) : "Le Random Forest bat la baseline de 18 points. Les 3 variables les plus décisives sont…".
- **Prédiction what-if** : formulaire pré-rempli d'une ligne, l'utilisateur modifie des valeurs et voit la prédiction changer en direct.
- **DoD :** la page résultats raconte une histoire complète à un non-expert.

### B.4 Sprint 4 — Projets, export & partage (≈ 1 semaine)

- **Projets** (Dexie/IndexedDB) : historique des runs, renommage, suppression, comparaison côte à côte de deux runs.
- **Exports** : modèle (JSON rechargeable), prédictions (CSV), **rapport HTML autonome** (imprimable en PDF via CSS print).
- **Lien de partage** : métriques + graphiques compressés (lz-string) dans le fragment d'URL ; page de lecture seule.
- **DoD :** un visiteur revient et retrouve ses projets ; un lien partagé s'ouvre sans les données d'origine.

### B.5 Sprint 5 — Qualité & polish (≈ 1 semaine)

- Accessibilité WCAG AA (navigation clavier, aria, contrastes vérifiés dans les deux thèmes, axe-core en CI).
- **PWA hors-ligne** (vite-plugin-pwa) : la démo ultime de la promesse privacy — *coupez le Wi-Fi, tout fonctionne encore*.
- Budgets Lighthouse en CI, **revue complète des traductions FR/EN** (y compris les interprétations en langage naturel générées, produites dans les deux langues), page "Comment ça marche / Confidentialité".

### B.6 V2 / V3 — extensions (post-MVP, priorisées en section D)

- **V2 :** MLP TensorFlow.js (WebGPU→WASM), GBDT histogramme TS maison (esprit LightGBM), recherche d'hyperparamètres (random search à budget temps), SHAP approché (Kernel SHAP échantillonné), PDP/ICE, import .xlsx/.parquet.
- **V3 :** `/ai/vision` (ONNX Runtime Web + modèles pré-entraînés type MobileNet), `/ai/chat` (LLM via proxy Cloudflare Worker — seules les *questions et statistiques agrégées* sortent, jamais les données brutes, avec consentement explicite), module `/data`, export ONNX, auth GitHub OAuth si des fonctionnalités le justifient.

---

## C. Intégration continue & déploiement

### C.1 GitHub Actions

Deux workflows (parallèle direct avec vos pipelines Azure DevOps) :

```
ci.yml (sur PR et main)
  lint (ESLint + Prettier check)
  → typecheck (tsc --noEmit)
  → test unitaires + golden tests (Vitest, couverture)
  → build (Vite)
  → e2e (Playwright, navigateur Chromium)
  → lighthouse-ci (budgets perf/a11y, non bloquant au début)

deploy.yml (après CI verte)
  PR    → wrangler pages deploy --branch=<pr>   ⇒ URL de preview par PR
  main  → wrangler pages deploy                 ⇒ production
```

- Déploiement via `cloudflare/wrangler-action` avec `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` en secrets GitHub (équivalent des variable groups Azure DevOps ; token scodé au seul projet Pages, principe du moindre privilège).
- **Previews par PR** = vos environnements éphémères : chaque PR a son URL de test.
- V2 : CodeQL + Dependabot/Renovate — vitrine DevSecOps.

### C.2 Cloudflare (DNS, SSL, routage)

1. **Pages** : projet `labml`, connecté au repo (déploiement piloté par Actions pour garder la CI en contrôle — le "plan/apply" reste dans GitHub).
2. **DNS** : `app.dominicdapice.com` en `CNAME` vers `<projet>.pages.dev`, proxy activé (nuage orange) ⇒ SSL universel automatique, CDN, HTTP/3. Le domaine apex reste sur GitHub Pages, aucune interférence.
3. **Routage par chemins** : c'est le **routeur SPA** qui gère `/ml`, `/data`, `/ai` — côté Cloudflare, un simple fallback `_redirects` (`/* /index.html 200`). Pas besoin de Workers pour le MVP : un Worker de routage ne servirait que si `/ai` devenait un jour une app séparée.
4. **`_headers`** : CSP stricte et en-têtes de sécurité (section E), servis par le CDN.

---

## D. Améliorations vs QuantifAI & priorisation

### D.1 Les 3 améliorations "signature" (ADN MLOps du portfolio)

1. **Observabilité de run intégrée.** Le leaderboard affiche pour chaque modèle : temps d'entraînement, **latence d'inférence p50/p95** (mesurée sur le jeu de test), mémoire estimée, backend de calcul (WASM/WebGPU). Un non-initié voit les scores ; un recruteur voit un réflexe Grafana/App Insights appliqué au ML. *(Sprint 2–3, coût marginal faible.)*
2. **Pipeline as code + reproductibilité.** Chaque run est défini par une **config déclarative** (JSON : seed, split, préprocessing, modèles, hyperparamètres) visualisable via un bouton "Voir le pipeline", ré-exécutable à l'identique, et exportable en **script Python scikit-learn équivalent**. C'est Terraform appliqué au ML : le run est le `apply` d'un plan versionné. *(Config dès le Sprint 2 ; bouton + export Python en Sprint 4/V2.)*
3. **Registre de modèles local avec lineage.** Les modèles sauvegardés portent version, stade (dev/staging/prod), config d'origine et hash du schéma de données ; comparaison diff entre deux runs et **alerte de dérive de schéma** quand un nouveau CSV du même projet ne correspond plus. MLflow-like, 100 % dans IndexedDB. *(Sprint 4 pour la base, V2 pour la dérive.)*

### D.2 Priorisation des améliorations du brief (section 4 du prompt)

| Amélioration demandée | Priorité | Où |
|---|---|---|
| Graphiques interactifs (zoom, filtre, export) | **MVP** | Sprints 1–3 (ECharts) |
| Gestion de projets (historique local) | **MVP** | Sprint 4 (IndexedDB) |
| Partage sans données | **MVP** | Sprint 4 (fragment URL) |
| Export modèle (JSON) + rapports (HTML/PDF) | **MVP** | Sprint 4 |
| Thème clair/sombre au choix de l'utilisateur | **MVP** (requis ferme) | Sprint 0 |
| Interface bilingue FR/EN | **MVP** (requis ferme) | Sprints 0 → 5 |
| Animations fluides, WCAG | **MVP** | Sprints 0 + 5 |
| Interprétabilité simplifiée (importance, lecture NL) | **MVP** | Sprint 3 |
| Réseaux de neurones (TensorFlow.js) | V2 | MLP après le zoo classique |
| Modèles boostés (esprit XGBoost/LightGBM) | V2 | GBDT TS maison ; port WASM à évaluer |
| SHAP/LIME approchés, PDP/ICE | V2 | après permutation importance |
| AutoML + hyperparamètres | V2 | random search à budget |
| Export ONNX / PMML | V3 | non trivial en navigateur, à réévaluer |
| Chat IA sur les données | V3 | proxy Worker + consentement explicite |
| Vision par ordinateur | V3 | ONNX Runtime Web, `/ai/vision` |
| Authentification | V3 | seulement si un besoin réel émerge |

**Logique de priorisation :** le MVP doit battre QuantifAI sur son propre terrain (parcours tabulaire + confiance + persistance + partage) avant d'élargir la surface. Chaque item V2/V3 est une brique indépendante grâce au découpage par features.

---

## E. Sécurité & confidentialité

- **Garantie "les données ne quittent pas le navigateur", vérifiable :**
  - CSP stricte via `_headers` : `default-src 'self'` — le navigateur *interdit* tout appel réseau vers des tiers ; fonts et assets self-hostés. La promesse n'est pas un texte marketing, elle est **observable dans l'onglet Réseau** (et on le dira tel quel sur la page Confidentialité).
  - Aucune télémétrie par défaut ; au plus, Cloudflare Web Analytics (sans cookies, agrégé) — et uniquement si vous le décidez.
  - PWA hors-ligne = preuve par l'usage.
- **En-têtes** : `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` ; COOP/COEP seulement si on active le multithread WASM (SharedArrayBuffer) en V2.
- **Clés API** : aucune dans le client, jamais. Le futur `/ai/chat` passera par un **Cloudflare Worker proxy** qui détient la clé (secret Wrangler), applique du rate-limiting, et ne relaie que des agrégats consentis.
- **Chaîne d'approvisionnement** : lockfile committé, Dependabot/Renovate, `npm audit` en CI, CodeQL (V2), permissions GitHub Actions minimales (`permissions: contents: read` par défaut).

## F. Tests & qualité

- **Unitaires (Vitest)** : composants critiques + toute la couche `metrics/`, `pipeline/`, `models/`.
- **Golden tests** — la pièce maîtresse pour un moteur ML maison : un script Python (exécuté hors CI, fixtures committées) calcule les valeurs de référence **scikit-learn** (métriques, prédictions de modèles simples à seed fixe) ; Vitest vérifie que notre implémentation TS reproduit ces valeurs à tolérance près. C'est notre contrat de non-régression scientifique.
- **Property-based (fast-check)** : parsing CSV (encodages, quotes, lignes malformées), invariants des métriques (bornes, symétries).
- **E2E (Playwright)** : le parcours complet — charger Titanic, choisir `survived`, entraîner, vérifier le leaderboard, exporter le rapport, recharger la page et retrouver le projet.
- **Performance** : Lighthouse CI avec budgets (perf ≥ 95, a11y ≥ 95, bundle initial < 200 Ko gz — les libs ML chargées paresseusement au premier entraînement).
- **A11y** : axe-core intégré aux e2e.

## G. Documentation & maintenance

- **README** : pitch, capture, badges CI, quickstart 3 commandes.
- **docs/ARCHITECTURE.md** + **ADRs** (`docs/adr/`) : chaque choix structurant tracé (framework, ECharts, moteur ML…) — le réflexe RFC/design-doc que les équipes attendent d'un tech lead.
- **Guide utilisateur intégré** à l'app (page "Comment ça marche") plutôt qu'un wiki externe.
- **Maintenance** : Renovate (mises à jour groupées hebdo), CHANGELOG en versionnage sémantique, monitoring léger (Cloudflare Analytics + error boundary avec rapport d'erreur *copiable manuellement* par l'utilisateur — pas d'envoi automatique, cohérence privacy).

---

## H. Décisions de cadrage

**Décisions validées le 20/08/2026 :**

| # | Décision | Choix validé |
|---|---|---|
| 1 | Framework | **Vite + React + TypeScript** (SPA statique) |
| 2 | UI / design system | **Tailwind CSS v4 + shadcn/ui** |
| 3 | Exécution ML (MVP) | **100 % navigateur** (Azure réservé aux extensions V3) |
| 4 | Déploiement | **GitHub Actions + wrangler** (previews par PR) |
| 5 | Langues | **Bilingue FR/EN** dès le Sprint 0 (addendum) |
| 6 | Thèmes | **Clair + sombre au choix de l'utilisateur** (addendum) |
| 7 | Palette | **Sarcelle/teal profond + accent cuivre — aucun jaune/ambre** (identité volontairement distincte de QuantifAI) |

**Questions encore ouvertes (non bloquantes pour le Sprint 0) :**

1. **Langue par défaut** quand le navigateur n'indique ni FR ni EN (recommandé : anglais, portée internationale du portfolio).
2. **Accès Cloudflare** : création du projet Pages + token API de votre côté (procédure pas à pas fournie au Sprint 0), ou d'abord une validation sur `*.pages.dev` avant de brancher le DNS ?

## I. Prochaines étapes concrètes

1. **Vous** : valider/amender les réponses aux questions H1–H6.
2. **Moi** : Sprint 0 — scaffold complet + design system + shell + CI/CD (PR dédiée, avec preview).
3. **Vous** : créer le projet Cloudflare Pages + token (guide fourni), ajouter les 2 secrets GitHub.
4. **Moi** : Sprints 1 → 2 dans la foulée — l'application devient *réellement* un ML Lab (upload → profilage → entraînement → leaderboard), puis Sprints 3 → 5.
5. Revue ensemble à chaque fin de sprint sur l'URL de preview.

# Analyse de la cible — QuantifAI (quantifai.co / app.quantifai.co)

> Analyse réalisée le 20/08/2026 sur le site réel (rendu Chromium via miroir local, réseau ouvert).
> Captures d'écran dans [`docs/img/`](img/). Complète la section 2 de [PLAN.md](../PLAN.md).

## 1. Méthode

Le HTML/CSS a été récupéré directement (`curl`), et le site a été rendu dans un Chromium headless
via un petit miroir local (le proxy d'egress de l'environnement coupait les connexions TLS du
navigateur ; le miroir Node relaie chaque requête via l'API `fetch` proxifiée). La **démo
interactive a été réellement exécutée** : sélection du dataset d'exemple `subscriptions.csv`
puis entraînement complet — les captures de résultats sont un vrai run, pas un mockup.

## 2. Architecture observée (instructif !)

| Élément | Observation |
|---|---|
| Landing `quantifai.co` | **Next.js** (SSR statique) avec **Tailwind + shadcn/ui** — les variables HSL `--background/--primary/--ring…` typiques de shadcn sont dans le CSS. Notre stack validé (React + Tailwind + shadcn/ui) est donc exactement celui de la cible. |
| ML Lab public | **Intégré à la landing** (section `#try`) : la démo sans compte tourne dans la page marketing. |
| `app.quantifai.co` | Produit **authentifié** (redirection `/ → /login`), pages statiques servies par **nginx**, HTML/CSS/JS artisanal (pas de framework). |
| Monitoring | CSP de l'app autorise `js.monitor.azure.com` → **Azure Application Insights** (!). |
| Sécurité app | CSP stricte, HSTS, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` — bonnes pratiques qu'on reprend dans nos `_headers`. |
| Fonts | Landing : self-hostées via `next/font`. App : **Google Fonts** (Hanken Grotesk, Inter, Plus Jakarta Sans). |

**Enseignement clé :** le "ML Lab" gratuit est une *section de la landing*, pas une application
séparée. LabML fera mieux : le lab complet **est** l'application (`/ml`), pas une vitrine.

## 3. Parcours utilisateur détaillé (démo exécutée)

1. **Choix des données** — panneau "ml_lab · new run" : zone de drop en pointillés + 3 datasets
   d'exemple avec leur taille (`subscriptions.csv 0.7 MB`, `support_tickets.csv 1.2 MB`,
   `home_prices.csv 0.9 MB`). Après sélection : "8,400 rows · read locally · classification".
2. **Colonnes** — chips par colonne ; `customer_id` affiché barré avec la mention `dropped`
   (identifiant écarté automatiquement) ; la cible `status` est mise en évidence par un chip
   ambre `target`. Excellent pattern de transparence, à reprendre.
3. **Entraînement** — bouton unique "Train Models" ; étapes affichées pendant le run :
   *Detecting the task type → Holding back a test split → Training a set of models → Ranking
   against a baseline* ; badge "running locally, no requests". Après le run, le bouton devient
   "Train again ↻".
4. **Résultats** (capture `quantifai-07`) :
   - **Leaderboard** 6 modèles avec barres de score : Gradient Boosting **0.91** (badge `BEST`),
     Random Forest 0.88, Logistic Regression 0.83, K-Nearest Neighbors 0.79, Decision Tree 0.77,
     **Naive baseline 0.61** classée comme un modèle parmi les autres.
   - **Métriques vs baseline** : panneaux Accuracy 0.91 et F1 0.89, chacun avec deux barres
     (MODEL en ambre / BASELINE en gris). Comparaison honnête, immédiate.
   - **Matrice de confusion** en langage humain : axes "said stays / said leaves" ×
     "is stays / is leaves" (742 / 38 / 55 / 845) — pas de jargon TP/FP.
   - **Feature signal · top drivers** : barres normalisées 0–100 (`last_login_days` 100,
     `tickets_opened` 81, `monthly_spend` 64, `tenure_months` 47, `plan` 33) + chips des
     3 features dominantes.
5. **Le "plain read"** (lecture en langage naturel) est annoncé comme partie des résultats.

## 4. Design system observé

### Tokens extraits du CSS (valeurs réelles)

| Rôle | Valeur |
|---|---|
| Brand / accent | `#ffbf00` (ambre), déclinaisons `#ecc165` (dim), `#ffdfa0` (fixed), `#6d5000` (ink), `#5c4300` (deep) |
| Fonds (crème chaude) | `#fdfbf7` (cream), `#fff8f2` (surface), `#fef2e1` (low), `#f2e7d6` (high), `#f8ecdc` (container) |
| Texte | `#201b11` (ink), `#4e4637` (soft), `#807665` (muted) |
| Secondaires | slate `#565e74` / `#d7dff9` ; succès `#1f7a4d` |
| Rayons | 16px (cartes), pilules complètes pour les boutons |
| Ombres | douces teintées d'encre + **glow ambre** `rgba(255,191,0,.32–.39)` sur les CTA |
| Layout | conteneur max 1200px, sections aérées, une idée par écran |

### Typographie

- **Display** : Hanken Grotesk (700–800), très grosses tailles, interlignage serré.
- **Body** : Inter. **Mono** : JetBrains Mono — utilisée massivement comme *voix technique* :
  eyebrows en majuscules espacées (`RUNS IN YOUR BROWSER`, `SAMPLE DATASETS`), labels de
  panneaux (`ml_lab · leaderboard`), métriques, chips de colonnes.

### Patterns UI marquants (captures)

- Hero : badge-eyebrow mono + titre géant dont la 2ᵉ ligne est **surlignée d'ambre**, carte
  leaderboard flottante à droite en guise d'illustration produit (`quantifai-01`).
- Sections rythmées par : eyebrow mono ambre → titre display 2 lignes → paragraphe court.
- Preuve privacy théâtralisée : faux panneau devtools "Network — 0 requests during training"
  (`quantifai-03`). L'argument phare : *"That is the proof, not a promise."*
- Cartes à fond blanc/crème, bordures discrètes, jamais de bordures dures.
- Login app (`quantifai-10`) : carte centrée minimaliste, cohérente avec la landing.
- Mobile (`quantifai-11`) : la landing reste propre, nav condensée, cartes empilées.
- **Thème unique clair** — aucun mode sombre nulle part.

## 5. Specs, limites et roadmap affichées

- **Formats** : CSV, TSV, TXT, JSON, JSONL, NDJSON.
- **Limites assumées** ("the honest envelope") : CPU only, fichier ≤ 10 Mo, ≤ 10 000 lignes,
  ≤ 200 colonnes, ≤ 80 features.
- **Roadmap publique** : GPU acceleration, larger datasets, more model types, model export,
  shareable reports.

## 6. Conséquences pour LabML

**À reprendre (l'esprit) :** friction zéro avec datasets d'exemple ; baseline naïve traitée
comme un modèle du leaderboard ; vulgarisation systématique (matrice de confusion en langage
humain, "plain read") ; transparence sur les colonnes écartées ; la preuve privacy par l'onglet
Réseau ; le ton honnête ("honest envelope") ; la voix mono pour tout ce qui est technique.

**Différenciations LabML déjà au plan — confirmées par l'analyse :**

| QuantifAI aujourd'hui | LabML (plan) |
|---|---|
| Thème clair unique | **Deux thèmes clair/sombre** au choix (requis ferme) |
| Anglais uniquement | **Bilingue FR/EN** (requis ferme) |
| CPU only, UI figée pendant le run (limites 10 Mo / 10 k lignes) | **Web Workers** (UI fluide, annulable) et limites plus hautes ; WebGPU en V2 |
| Model export / shareable reports "sur la roadmap" | **Dans le MVP** (Sprint 4) : export JSON/CSV/rapport HTML + lien de partage sans données |
| Pas de persistance visible sans compte | **Projets locaux IndexedDB** sans compte (Sprint 4) |
| Démo dans la landing, produit derrière login | **Le lab complet est l'app**, sans compte |
| Pas d'observabilité | **Latence p50/p95, temps d'entraînement, backend de calcul** par modèle |
| Interprétabilité : importance seulement | + permutation importance, PDP/ICE, what-if (Sprints 3, V2) |

**Identité visuelle : distincte assumée.** QuantifAI = ambre `#ffbf00` sur crème chaud clair.
LabML gardera *les patterns* (eyebrows mono, cartes douces, baseline honnête, surlignage
d'accent) mais avec **sa propre palette** (dominante sarcelle/teal profond + accent cuivre,
déclinée clair **et** sombre) et sa propre typographie — à fixer au design system du Sprint 0.

## 7. Captures

| Fichier | Contenu |
|---|---|
| [`quantifai-01-hero.png`](img/quantifai-01-hero.png) | Hero + carte leaderboard flottante |
| [`quantifai-02-how.png`](img/quantifai-02-how.png) | "Four steps from a file to a result" |
| [`quantifai-03-privacy.png`](img/quantifai-03-privacy.png) | Section privacy + faux devtools "0 requests" |
| [`quantifai-04-specs.png`](img/quantifai-04-specs.png) | Specs, limites, roadmap |
| [`quantifai-06-demo-sample.png`](img/quantifai-06-demo-sample.png) | Démo : dataset sélectionné, chips de colonnes |
| [`quantifai-07-demo-results.png`](img/quantifai-07-demo-results.png) | **Résultats réels** : leaderboard, métriques vs baseline, confusion, features |
| [`quantifai-08-demo-results-2.png`](img/quantifai-08-demo-results-2.png) | CTA final + footer |
| [`quantifai-10-app-login.png`](img/quantifai-10-app-login.png) | Login de l'app authentifiée |
| [`quantifai-11-mobile-hero.png`](img/quantifai-11-mobile-hero.png) | Rendu mobile (390px) |

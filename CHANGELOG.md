# Changelog

Generated from the roadmap tables in `PLAN.md` by `npm run changelog` — not edited by
hand: a unit test fails when this file and the plan disagree, in either direction. One
entry per wave, newest first; the first six waves (V1–V6, the MVP) predate the tables and
are recorded in PLAN.md §B and §J. Each entry carries the opening sentence of its row and
the reason the wave was built.

## V40 — Data Studio: validity, drift, and an auditable diff

Quality was measured as completeness and consistency of type; what was missing is **validity** — a value can be present, correctly typed and still impossible.

_Why:_ Came last because it builds on V38's faithful read and V39's per-column recipe: validity rules on mis-parsed numbers would have flagged the parser, not the data. Closes the Data Studio group. Of the 36 new unit tests, eleven assert that a rule REFUSES to fire — a rule that flags a good file is worse than no rule, because it teaches the reader to ignore the panel.

## V39 — Data Studio: a recipe that works column by column

`RecipeOptions` applied `missing` and `clipOutliers` to the **whole file** — one strategy for every column, however different they are.

_Why:_ A single global strategy is the kind of default that looks tidy and quietly makes the data worse; per-column steps cost little to build because the recipe was already an object, not a pile of checkboxes. The build confirmed it: the engine change is contained in one stage of `applyRecipe`, and the 17 pre-existing recipe tests passed untouched.

## V38 — Data Studio: reading the file exactly as it was written

The headline item was a **defect in shipped code, not a missing feature**, and the wave opened by proving it.

_Why:_ Owner request (22/08/2026): what to improve in /data. The audit found a defect first, and the wave began by reproducing it end to end: a French-locale CSV — the single most likely file this owner's users will open — silently loses every numeric column. The repair is exact rather than approximate: the French file now trains to the same types, the same feature count and the same score, to ten decimal places, as the file that never had the problem.

## V37 — ML Lab: speed and the comfort of long sessions

The wave opened, as the plan demanded, with a measurement — and the measurement moved the wave.

_Why:_ Launched 23/08/2026, after V36. The plan said « measure before and after so the gain is published rather than claimed » — and the measurement is what turned the wave around: the promised parallelism was worth 6%, while the bottleneck it revealed was worth 5×. Two latent defects fell out of the same instrumentation: models corrupted by structured clone, and an inference column reading 0 ms for every parallel family.

## V36 — ML Lab: the gaps that were deliberately left open

Each item was consciously deferred in an earlier wave rather than forgotten; delivering them together keeps the descopes visible instead of letting them quietly become permanent.

_Why:_ Launched 23/08/2026, right after V35. Each item was a named descope, not an oversight — and the ensemble exposed one more silent-disappearance defect, of the same family as the one V35 found.

## V35 — ML Lab: the number stops flattering itself

Two method defects in shipped code, fixed, plus the two additions that follow from them.

_Why:_ Owner request (22/08/2026), launched 23/08/2026. Two of the four items were defects rather than gaps: a lab that sells honest evaluation cannot ship a headline figure it knows to be optimistic, nor a split that leaks on dated data.

## V34 — The explanations, the how-to guides, and a limits page extracted from this very file

Six new pages per language — two explanations (the method choices; what LabML does not do) and four task-shaped how-to guides (score a batch, compare two runs, read a learning curve, hand a SQL result to the lab) — bringing the documentation to **twelve pages per language across all four Diátaxis quadrants**.

_Why:_ Three audiences, deliberately: the curious visitor (five minutes), the practitioner (one task), and the evaluator judging whether the engineering is rigorous. The explanation pages are what the third one reads.

## V33 — The reference, and a table of refusals extracted from the code rather than from memory

Five pages per language — the refusals table, ML Lab, Data Studio, Vision & assistant, and file formats — grouped by section rather than one page per panel, so a lookup lands on one page with anchors instead of hunting across twenty.

_Why:_ A feature nobody can look up is a feature that does not exist for the reader; and a refusal nobody can decode reads as a bug rather than as the design it is.

## V32 — Documentation that cannot lie — and a measurement that rewrote this row's own rule

A `/docs` route, linked from the footer, built on the **Diátaxis** split, with the Markdown living in `src/content/docs/<lang>/*.md` and compiled **at build time**: the reader downloads finished pages, an outline and a search index — never a parser, and never a request to a documentation host.

_Why:_ label`compiles to a deep link, and`/ml`now reads`?demo=`and`?target=`. A screenshot is a claim about the past that rots silently; a deep link either works or the e2e catches it. The parameter becomes a fetched path, so it is resolved against the shipped demo list and nothing else — an e2e test asserts that `?demo=../../../etc/passwd`fetches nothing. **What this wave deliberately does not do**: write the reference pages before the template is settled (rewriting all of them is the predictable cost), hand-take a screenshot, or claim the figure guard is total.`marked` is a build-time devDependency and never reaches the browser. 601 unit tests, 86 e2e.

## V31 — Vision that says « I do not know » — and a bench that refuted three of this row's own predictions

**(A) Measure first**, as V30 taught: the complaint « it still makes mistakes » is not a measurable statement.

_Why:_ Owner report (22/08/2026): the vision playground is better than the chat but still makes mistakes. Naming the label-space mismatch is what turns a vague complaint into a fixable defect.

## V30 — Chat that reads better, measured before it is made bigger

The wave began by building the instrument, because V27's stood on 18 cases that needed a GPU with `shader-f16` — one laptop's worth of evidence, re-runnable by nobody.

_Why:_ Owner question (22/08/2026): would a bigger model raise the share of correct answers? The wave answers with a measurement rather than an estimate, and the answer has two halves. For **0 MB**, the app went from **33 right / 15 wrong** to **42 right / 7 wrong** out of 55 — nine more correct answers and **fifty-three percent fewer wrong ones**, the single largest piece of which came from the deterministic parser rather than the model. And the second half was measured too, not deferred: **Qwen3-1.7B at 1.43 GB — four times the download — scores worse** (40 right / 12 wrong against 42 / 7). It reads the hard questions better and the easy ones worse. « Bigger » is not a direction of improvement on this task; it is a trade whose sign has to be measured, and the bench now measures it in one command.

## V29 — Analytical SQL in the browser (DuckDB-Wasm, MIT)

**Analytical SQL in the browser (DuckDB-Wasm, MIT)**: the Data Studio gains a real OLAP engine — joins, window functions, aggregations — over the file you just loaded, with no server and no upload.

_Why:_ Owner request (21/08/2026): real analytical SQL on ~100 MB files with zero backend. Delivered after the /privacy page at the owner's request (22/08/2026).

## V28 — « Ne nous croyez pas sur parole »

**« Ne nous croyez pas sur parole »** — a `/privacy` route that states the local-only promise once, in full, and then hands the reader the means to check it without trusting a word of it.

_Why:_ Owner request (22/08/2026): the promise is repeated across the site, but a user has no way to tell a true claim from a comforting one. Verifiability is the product here — anyone can write « your data stays local » in a footer.

## V27.3 — A `>=` that was quietly an `=`

**A `>=` that was quietly an `=`**: retesting the comparison question after V27.2 produced « 0 ligne correspond où fare >= 0 » — impossible on a table where all 891 fares clear zero.

_Why:_ Found by retesting in production (22/08/2026). An arithmetically impossible answer — zero rows for a condition every row satisfies — is worse than a refusal and worse than a wrong reading: it makes the engine itself untrustworthy, which is the one thing LabML sells.

## V27.2 — Two honesty defects, one measured, one found while reading the measurement

**Two honesty defects, one measured, one found while reading the measurement**: (1) the comparison question V27.1 left wrong — « est-ce que les femmes payaient plus cher que les hommes ? » read as a correlation between `fare` and `age` — gets a rule that names both halves of the mistake: a question comparing two groups is an aggregate with `groupBy` on the column whose values name them, NEVER a correlation; and never pick a column the question does not mention.

_Why:_ Measured by the owner on real hardware (22/08/2026): 5 of 6 reference questions right after V27.1. The sixth is a confidently wrong answer to a different question than the one asked, and the « sur 891 lignes » wording was found by reading that same screenshot closely — a right number inside a wrong sentence is exactly what this project refuses to ship.

## V27.1 — The model earns its place, it does not take it

**The model earns its place, it does not take it**: the V27 order was wrong, and the measurement said so.

_Why:_ Measured by the owner in production (22/08/2026), the day V27 shipped. A confidently wrong answer costs more trust than a refusal — and V27 produced two of them, including a 0 where the deterministic engine already had the right 168.

## V27 — Local chat, upgraded

**Local chat, upgraded**: a real language model — **Qwen3-0.6B-DQ, 355 MB, Apache-2.0** — running entirely in the browser, offered beside the V6 deterministic interpreter, which stays the DEFAULT and the fallback.

## V26 — Learning curves

**Learning curves**: the lab answers the classic budget question — "would more data help this model, or is it time to work on features?" — with one new chart.

## V25 — Scale

**Scale**: the lab now takes 100k–1M-row files without dying, on a measure-first design.

## V24 — Text columns

**Text columns**: free text stops being skipped and enters the pipeline as a hand-written **TF-IDF** block — accent-folding bilingual tokenizer, merged FR/EN stop words, vocabulary capped at 256 terms ranked by document frequency (ties alphabetical, terms seen in a single training document dropped), smoothed IDF, L2-normalized vectors, fitted on the training split only.

_Why:_ Real CSVs have text columns (comments, descriptions) — the lab used to drop them on the floor

## V23 — Vision 2

**Vision 2**: SqueezeNet (2012) retired for three self-hosted ONNX models — **EfficientNet-Lite4 int8** classification (1,000 ImageNet classes, 77.6% top-1), **YOLOX-Nano** object detection (80 COCO classes; the stronger-but-AGPL YOLOs were ruled out, Apache-2.0 kept) and **UltraFace RFB-320** face detection — boxes drawn on the image, FR/EN class names, plain-language counts ("1 person · 1 face").

_Why:_ Owner request (21/08/2026): portraits have no ImageNet class, so the old model answered off-target — and the detector must recognize a whole range of things, not just faces

## V22 — The model comes back

**The model comes back**: export as format v2 — the JSON embeds the fitted pipeline (imputation/encoding/standardization), the target, the classes and the exporting run's test metrics as an honest reference.

_Why:_ Closes the last loop: train today, come back in a month, score

## V21 — Compare two runs

**Compare two runs**: check two runs in the history → side-by-side diff on /ml/compare — features added/removed as ± badges, every model's metric in an A/B/Δ table (signed colors), plain-language read of the best model's movement, and a cross-run verdict when both runs carry V20 CIs (disjoint → the gap exceeds both uncertainties; overlapping → possibly noise).

_Why:_ "Did my cleaning help?" — the central iterative gesture of ML

## V20 — Honest uncertainty

**Honest uncertainty**: seeded bootstrap of the test set (1,000 resamples shared across models — paired comparisons) → percentile 95% CI on every leaderboard model's main metric (whiskers on a shared scale), plain-language paired winner-vs-baseline verdict ("the gap survives resampling — probably real" / "the interval crosses zero — possibly noise"), analysis attached to the run (history/report/share).

_Why:_ `0.82` on 178 rows is not `0.82`; say what the number does not say

## V19 — Persistent projects

**Persistent projects**: the dataset joins the project, opt-in ("keep in this browser") — lz-string-compressed CSV in IndexedDB, explicit 50 MB budget (named refusal with the numbers, never a silent cut), saved list (reopen/forget) under the history, runs linked to the saved dataset ("reopen this run's data"), identical retraining (seed 42).

_Why:_ A refresh erased everything; "projects" are only real if they survive

## V18 — Per-segment analysis

**Per-segment analysis**: after a run, the test set is sliced by every categorical column — including those excluded from the features, where proxy effects hide — and the inspected model's metric (accuracy or RMSE) is recomputed per slice, gap vs global signed and sorted worst-first.

_Why:_ "Where does my model fail?" — an honest gateway to fairness

## V17 — Data Studio 3: joins & anomalies

**Data Studio 3: joins & anomalies**: left join of a second file on a shared key (exact match after trim — a dirty key becomes a named orphan, never silence; match rate, duplicates, unused rows; the joined result becomes THE dataset), and **multivariate anomalies** via a hand-written seeded isolation forest (100 trees, exact c(n)) as a step of the **replayable recipe** (threshold 0.6).

_Why:_ Real data prep starts by crossing two files; multivariate anomalies see what Tukey misses

## V16 — Imbalance & thresholds

**Imbalance & thresholds**: precision-recall curve (AP, chance line drawn), adjustable decision threshold priced by a cost matrix (false alarm vs missed case, one-click optimum), calibration curve (Brier), imbalanced demo `fraud.csv`; the chosen threshold joins the run.

_Why:_ Real datasets are imbalanced; accuracy lies there

## V15 — Score a new batch

**Score a new batch**: after a run, drop a new file → the inspected model scores it in the browser (exportable predictions, all columns preserved); if the target is present, honest test-vs-batch comparison (unknown labels excluded and counted); schema validated, drifted demo `iris-field.csv`, score attached to the run (history/report/share)

_Why:_ The complete MLOps loop: V11 says "the inputs moved", V15 says "does the model still hold"

## V14 — Generalized prerendering

**Generalized prerendering**: static shells for all six sections (the V9 approach extended — inlined CSS, Latin fonts as data:, per-route preloaded façade, header template), Lighthouse /ml 0.86 → 0.99 and /data 1.0 under real throttling (3-run medians); the root stays the SPA fallback (accepted)

_Why:_ The last Lighthouse gap

## V13 — Complete runs

**Complete runs**: tuning, latest Shapley explanation, exploration and forecast attached to the run record — IndexedDB history (with chips), stored-run page, HTML report and v2 share links (subsampled scatter plots in the URL; v1 links remain decodable)

_Why:_ The V5–V8 artifacts did not survive the run

## V11 — Data drift

**Data drift** in the Data Studio: a reference file, a file to compare → schema differences (columns added/removed/retyped), **PSI per column** (quantile bins from the reference, thresholds 0.1/0.25), new/vanished categories, missing-rate gaps, overall verdict — with a deliberately drifted demo (`cafe-sales-june.csv`)

_Why:_ The MLOps gesture par excellence: checking that a new batch looks like what the model learned on

## V10 — Data Studio 2

**Data Studio 2**: importable recipe replayable on a new file, per-column forced types, derived columns

_Why:_ Completes the reproducibility loop

## V9 — Performance & comfort

**Performance & comfort**: /ml Lighthouse budget ≥ 0.90 (preloads, splitting), PWA update toast, webcam for vision (Permissions-Policy to open)

_Why:_ Perceived quality and scores

## V8 — Time series

**Time series**: date + numeric target detection → trend/season decomposition, hand-written Holt-Winters forecasting, rolling-origin backtest

_Why:_ Opens up an entire class of problems

## V7 — Unsupervised exploration

**Unsupervised exploration** in the ML Lab: hand-written k-means (seeded k-means++ init, k ∈ 2–5 chosen by silhouette), hand-written 2D PCA projection (power iteration), plain-language group profiles, scatter plot with colors **and shapes** (palette validated for color blindness by the design-system validator)

_Why:_ Fills the real gap: today the lab requires a target; many datasets are explored first without one

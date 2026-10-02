# V45 Multiclass Decisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn V36's one-vs-rest diagnostics into a complete, deterministic multiclass decision policy with explicit abstention, honest validation-before-test evaluation, persistence, batch scoring, and backward-compatible model export.

**Architecture:** Put policy application and metrics in a pure `multiclass-decision.ts` module shared by the worker, persistence, and batch scoring. The worker exposes validation probabilities for interactive editing but keeps test probabilities private until the policy is frozen; later edits may request a new test evaluation only with an `exploratory` marker. UI state, run artifacts, reports, batch CSV, and model manifests all carry the same typed `MulticlassDecisionPolicy`.

**Tech Stack:** TypeScript 6, React 19, Zustand, Web Worker messages, Vitest, Playwright, i18next, IndexedDB/Dexie.

**Spec:** `PLAN.md` §N, row `V45 — pending`

## Global Constraints

- Preserve 100% in-browser execution; no telemetry, API call, or new runtime dependency.
- Keep binary threshold behavior unchanged.
- A threshold of `0` means no minimum and must reproduce the current argmax decision with 100% coverage.
- Eligible classes clear their own minimum probability; one eligible class wins directly.
- Multiple eligible classes are ordered by normalized excess `(probability - threshold) / (1 - threshold)`, then stable class index.
- No eligible class produces an explicit abstention; never fall back silently to argmax.
- Tune on the validation split only; reveal test evaluation only after the policy is frozen.
- Any policy edited after the first test reveal must be labeled `exploratory`.
- Model export format becomes v4; v2 and v3 remain importable and behave as today when no policy exists.
- Batch CSV keeps raw argmax and probabilities, and adds policy decision plus `decided`/`abstained`.
- Do not add automatic threshold selection, a full misclassification-cost matrix, conformal claims, or binary behavior changes.
- Use `NODE_OPTIONS=--no-experimental-webstorage` for Vitest on Windows.

## Review Focus

- A class threshold of exactly `1` with probability `1` remains eligible and produces a finite arbitration score; pin this in Task 1.
- A policy whose threshold count differs from the class/probability count is rejected by name instead of being truncated; pin this in Task 1.
- A run too small to have a validation split refuses the editor rather than tuning on test; pin this in Task 2.
- Imported v2/v3 and v4-without-policy models retain their historical argmax scoring and CSV shape; pin this in Tasks 5 and 6.
- Labeled batch rows that abstain or carry an unseen target label remain distinct in counts and metrics; pin this in Task 5.

---

### Task 1: Pure Multiclass Decision Policy

**Files:**

- Create: `src/features/ml/train/multiclass-decision.ts`
- Create: `src/features/ml/train/multiclass-decision.test.ts`

**Interfaces:**

- Consumes: per-row class probabilities and encoded labels.
- Produces:
  - `MulticlassDecisionPolicy { thresholds: number[] }`
  - `MulticlassDecision { rawClass: number; policyClass: number | null; status: 'decided' | 'abstained' }`
  - `ClassDecisionMetrics { classIndex: number; support: number; precision: number; recall: number; f1: number }`
  - `MulticlassDecisionMetrics { rows: number; decided: number; abstained: number; coverage: number; accuracy: number; decidedAccuracy: number; macroPrecision: number; macroRecall: number; macroF1: number; perClass: ClassDecisionMetrics[] }`
  - `applyMulticlassPolicy(probabilities: number[], policy: MulticlassDecisionPolicy): MulticlassDecision`
  - `evaluateMulticlassPolicy(labels: number[], probabilities: number[][], policy: MulticlassDecisionPolicy): MulticlassDecisionMetrics`

- [ ] **Step 1: Write failing policy-selection tests**

In `multiclass-decision.test.ts`, add tests that assert:

```ts
expect(applyMulticlassPolicy([0.6, 0.3, 0.1], { thresholds: [0, 0, 0] })).toMatchObject({
  rawClass: 0,
  policyClass: 0,
  status: 'decided',
});
expect(applyMulticlassPolicy([0.55, 0.4, 0.05], { thresholds: [0.5, 0.2, 0.1] }).policyClass).toBe(
  1,
);
expect(applyMulticlassPolicy([0.4, 0.35, 0.25], { thresholds: [0.5, 0.5, 0.5] }).status).toBe(
  'abstained',
);
expect(applyMulticlassPolicy([1, 0, 0], { thresholds: [1, 0.5, 0.5] }).policyClass).toBe(0);
expect(applyMulticlassPolicy([0.6, 0.6], { thresholds: [0.5, 0.5] }).policyClass).toBe(0);
expect(() => applyMulticlassPolicy([0.6, 0.4], { thresholds: [0.5] })).toThrow('bad-policy');
```

- [ ] **Step 2: Run the policy tests and verify they fail**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npx vitest run src/features/ml/train/multiclass-decision.test.ts`

Expected: FAIL because `multiclass-decision.ts` does not exist.

- [ ] **Step 3: Implement the policy types and `applyMulticlassPolicy`**

Validate equal, non-empty lengths and finite thresholds in `[0, 1]`; throw `bad-policy` otherwise. Treat `(probability, threshold) === (1, 1)` as normalized excess `1` to avoid division by zero. Use first index for exact ties.

- [ ] **Step 4: Run the policy tests and verify they pass**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npx vitest run src/features/ml/train/multiclass-decision.test.ts`

Expected: all policy-selection tests PASS.

- [ ] **Step 5: Add failing evaluation tests**

Assert zero thresholds yield coverage `1` and the same accuracy as argmax; an abstention counts as an error in `accuracy` but is excluded from `decidedAccuracy`; macro and per-class metrics use the full declared class count, including a class with zero predicted positives.

- [ ] **Step 6: Implement `evaluateMulticlassPolicy` and rerun the tests**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npx vitest run src/features/ml/train/multiclass-decision.test.ts`

Expected: all tests PASS with finite metrics for empty decided sets (`decidedAccuracy = 0`).

- [ ] **Step 7: Commit the pure policy**

```powershell
git add src/features/ml/train/multiclass-decision.ts src/features/ml/train/multiclass-decision.test.ts
git commit -m "feat(ml): add multiclass decision policy"
```

### Task 2: Validation-First Worker Analysis and Test Gate

**Files:**

- Create: `src/features/ml/train/multiclass-decision-analysis.ts`
- Create: `src/features/ml/train/multiclass-decision-analysis.test.ts`
- Modify: `src/features/ml/train/trainer.ts:41-50, 411-430, final TrainArtifacts construction`
- Modify: `src/features/ml/worker-protocol.ts:23-103`
- Modify: `src/features/ml/data/parse.worker.ts:470-490`

**Interfaces:**

- Consumes: Task 1 policy functions; trained model; validation and test splits.
- Produces:
  - `TrainArtifacts.validationX: number[][]` and `TrainArtifacts.validationY: number[]`
  - `MulticlassDecisionAnalysis { model: ModelKey; classes: string[]; validationProbabilities: number[][]; validationLabels: number[] }`
  - `MulticlassDecisionTestResult { policy: MulticlassDecisionPolicy; metrics: MulticlassDecisionMetrics; exploratory: boolean }`
  - `analyzeMulticlassDecision(artifacts: TrainArtifacts, model: ModelKey): MulticlassDecisionAnalysis | null`
  - `testMulticlassDecision(artifacts: TrainArtifacts, model: ModelKey, policy: MulticlassDecisionPolicy, exploratory: boolean): MulticlassDecisionTestResult`
  - Requests `multiclass-decision-analysis` and `multiclass-decision-test`
  - Responses `multiclass-decision-result` and `multiclass-decision-tested`

- [ ] **Step 1: Write failing analysis tests**

Cover a three-class probabilistic model with validation rows, a binary run, a model without `predictProba`, and an empty validation split. Assert only the first case returns analysis; the empty-validation case returns `null` and never substitutes `testX`.

- [ ] **Step 2: Run the analysis tests and verify they fail**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npx vitest run src/features/ml/train/multiclass-decision-analysis.test.ts`

Expected: FAIL because the module and validation artifacts do not exist.

- [ ] **Step 3: Retain validation matrices in `TrainArtifacts`**

Set `validationX`/`validationY` from the existing `valX`/`valY`, using empty arrays when the validation split is refused. Do not change fitting, ranking, or test-split selection.

- [ ] **Step 4: Implement analysis and gated test evaluation**

`analyzeMulticlassDecision` returns validation probabilities only for `classes.length > 2`, non-empty validation, and models with `predictProba`. `testMulticlassDecision` evaluates the same policy on private `testX`/`testY` and echoes the caller's `exploratory` flag.

- [ ] **Step 5: Add worker protocol and handlers**

The analysis response may expose validation arrays. The test response exposes only aggregate `MulticlassDecisionMetrics`, never test probabilities or row labels.

- [ ] **Step 6: Run focused and trainer regression tests**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npx vitest run src/features/ml/train/multiclass-decision-analysis.test.ts src/features/ml/train/v36.test.ts src/features/ml/train/models.test.ts`

Expected: all tests PASS; V36 one-vs-rest behavior remains unchanged.

- [ ] **Step 7: Commit worker analysis**

```powershell
git add src/features/ml/train/multiclass-decision-analysis.ts src/features/ml/train/multiclass-decision-analysis.test.ts src/features/ml/train/trainer.ts src/features/ml/worker-protocol.ts src/features/ml/data/parse.worker.ts
git commit -m "feat(ml): gate multiclass policy evaluation"
```

### Task 3: Policy Editor, Freeze Flow, and Honest State

**Files:**

- Create: `src/features/ml/train/multiclass-decision-state.ts`
- Create: `src/features/ml/train/multiclass-decision-state.test.ts`
- Create: `src/features/ml/components/MulticlassDecisionPanel.tsx`
- Modify: `src/features/ml/components/RunView.tsx`
- Modify: `src/features/ml/lab-store.ts:60-150, 180-200, worker response handler, actions`
- Modify: `src/locales/fr.json:467-490`
- Modify: `src/locales/en.json:467-490`
- Test: `src/features/ml/train/multiclass-decision.test.ts`
- Test: `e2e/imbalance.spec.ts`

**Interfaces:**

- Consumes: Task 1 evaluation, Task 2 worker messages.
- Produces:
  - `MulticlassDecisionPhase = 'draft' | 'frozen' | 'exploratory'`
  - `MulticlassDecisionEditorState { policy: MulticlassDecisionPolicy; phase: MulticlassDecisionPhase; test: MulticlassDecisionTestResult | null }`
  - `editMulticlassThreshold(state: MulticlassDecisionEditorState, classIndex: number, threshold: number): MulticlassDecisionEditorState`
  - `receiveMulticlassDecisionTest(state: MulticlassDecisionEditorState, result: MulticlassDecisionTestResult): MulticlassDecisionEditorState`
  - `isExploratoryTestRequest(state: MulticlassDecisionEditorState): boolean`
  - store state `multiclassDecisionAnalysis` and `multiclassDecisionEditor`
  - actions `setMulticlassThreshold(classIndex: number, threshold: number): void` and `freezeMulticlassDecision(): void`
  - `MulticlassDecisionPanel` with test IDs `multiclass-decision-panel`, `multiclass-threshold-{index}`, `multiclass-freeze`, and `multiclass-test-state`

- [ ] **Step 1: Add failing store/component behavior assertions**

In `multiclass-decision-state.test.ts`, pin the pure state transitions:

```ts
expect(isExploratoryTestRequest(draft)).toBe(false);
expect(receiveMulticlassDecisionTest(draft, firstResult).phase).toBe('frozen');
expect(editMulticlassThreshold(frozen, 1, 0.7).phase).toBe('exploratory');
expect(isExploratoryTestRequest(exploratory)).toBe(true);
expect(receiveMulticlassDecisionTest(exploratory, revisedResult).phase).toBe('exploratory');
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npx vitest run src/features/ml/train/multiclass-decision-state.test.ts`

Expected: FAIL because `multiclass-decision-state.ts` does not exist.

- [ ] **Step 3: Implement store state and actions**

Implement the pure transition functions first, then have the store delegate every policy edit and worker test response to them. Initialize one zero threshold per class when analysis arrives. Compute validation metrics locally with Task 1. Never request test evaluation from a slider change. `freezeMulticlassDecision` sends the value from `isExploratoryTestRequest`.

- [ ] **Step 4: Implement `MulticlassDecisionPanel`**

Show each class threshold, validation coverage, overall accuracy, decided accuracy, macro precision/recall/F1, per-class metrics, and untouched argmax baseline. Disable the editor with a named explanation when Task 2 returns `null`. Label the first test result frozen and every later one exploratory.

- [ ] **Step 5: Add bilingual copy**

Add matching FR/EN keys under `ml.lab.multiclassDecision`; use “aucune décision” / “no decision” rather than “uncertain,” and state that validation tuned the policy while test measured it.

- [ ] **Step 6: Extend the multiclass Playwright scenario**

In `e2e/imbalance.spec.ts`, assert the panel appears on the multiclass demo, zero thresholds show 100% validation coverage, raising every threshold can produce abstentions, the first freeze shows a non-exploratory test result, and an edit after freeze changes the state to exploratory.

- [ ] **Step 7: Run unit and Playwright tests**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npx vitest run src/features/ml/train/multiclass-decision.test.ts src/features/ml/train/multiclass-decision-analysis.test.ts src/features/ml/train/multiclass-decision-state.test.ts`

Run: `npx playwright test e2e/imbalance.spec.ts`

Expected: all focused tests PASS.

- [ ] **Step 8: Commit the policy editor**

```powershell
git add src/features/ml/train/multiclass-decision-state.ts src/features/ml/train/multiclass-decision-state.test.ts src/features/ml/components/MulticlassDecisionPanel.tsx src/features/ml/components/RunView.tsx src/features/ml/lab-store.ts src/locales/fr.json src/locales/en.json e2e/imbalance.spec.ts
git commit -m "feat(ml): add multiclass policy editor"
```

### Task 4: Persisted Artifact, Stored Runs, and Report

**Files:**

- Modify: `src/features/ml/projects/types.ts:20-48`
- Modify: `src/features/ml/lab-store.ts:225-260`
- Modify: `src/features/ml/components/RunArtifactsView.tsx`
- Modify: `src/features/ml/projects/report.ts:175-195`
- Modify: `src/features/ml/projects/projects.test.ts`

**Interfaces:**

- Consumes: Task 1 policy/metrics and Task 3 frozen/exploratory state.
- Produces:
  - `MulticlassDecisionArtifact { model: ModelKey; classes: string[]; policy: MulticlassDecisionPolicy; validation: MulticlassDecisionMetrics; test: MulticlassDecisionMetrics; exploratory: boolean }`
  - `RunArtifacts.multiclassDecision?: MulticlassDecisionArtifact`

- [ ] **Step 1: Add failing persistence and report tests**

Extend `projects.test.ts` with a run carrying `multiclassDecision`. Assert share encode/decode preserves thresholds, abstention metrics, and `exploratory`; stored artifact rendering and generated report include coverage, validation/test metrics, per-class thresholds, and the exploratory warning.

- [ ] **Step 2: Run the project tests and verify they fail**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npx vitest run src/features/ml/projects/projects.test.ts`

Expected: FAIL because the artifact and rendering do not exist.

- [ ] **Step 3: Add the artifact type and attach it only after test evaluation**

Do not persist validation-only slider drafts. When the worker returns a test result, attach the exact policy, local validation metrics, aggregate test metrics, and `exploratory`.

- [ ] **Step 4: Render stored/shared artifacts and reports**

Use the same FR/EN copy as the live panel. Keep old runs without this artifact unchanged.

- [ ] **Step 5: Run project and hostile-share tests**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npx vitest run src/features/ml/projects/projects.test.ts src/features/ml/projects/share-hostile.test.ts`

Expected: all tests PASS.

- [ ] **Step 6: Commit persistence and reports**

```powershell
git add src/features/ml/projects/types.ts src/features/ml/lab-store.ts src/features/ml/components/RunArtifactsView.tsx src/features/ml/projects/report.ts src/features/ml/projects/projects.test.ts
git commit -m "feat(ml): persist multiclass decisions"
```

### Task 5: Batch Scoring With Abstention

**Files:**

- Modify: `src/features/ml/train/score.ts`
- Modify: `src/features/ml/train/score.test.ts`
- Modify: `src/features/ml/components/BatchScorePanel.tsx`
- Modify: `src/features/ml/lab-store.ts`
- Modify: `src/features/ml/data/parse.worker.ts`
- Modify: `src/features/ml/worker-protocol.ts`
- Modify: `src/locales/fr.json`
- Modify: `src/locales/en.json`
- Test: `e2e/imbalance.spec.ts`

**Interfaces:**

- Consumes: `MulticlassDecisionPolicy` and the frozen live run artifact.
- Produces:
  - `RowScorer.decisionPolicy?: MulticlassDecisionPolicy`
  - `BatchScore.decision?: MulticlassDecisionMetrics`
  - preview fields `rawPredicted`, `policyPredicted: string | null`, and `decisionStatus`
  - CSV columns `predicted`, all `p_<class>`, `policy_decision`, `decision_status`

- [ ] **Step 1: Write failing batch-policy tests**

Add a three-class scorer whose policy decides one row and abstains on another. Assert:

```ts
expect(score.preview.map((row) => row.decisionStatus)).toEqual(['decided', 'abstained']);
expect(score.csv.split('\n')[0]).toBe(
  'feature,label,predicted,p_a,p_b,p_c,policy_decision,decision_status',
);
expect(score.decision?.coverage).toBe(0.5);
```

Also assert unseen target labels increase `unknownLabels` but not `abstained`, and a scorer without policy preserves the historical header exactly.

- [ ] **Step 2: Run score tests and verify they fail**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npx vitest run src/features/ml/train/score.test.ts`

Expected: FAIL on missing policy fields and CSV columns.

- [ ] **Step 3: Thread the frozen policy through live scoring**

Pass the frozen artifact policy to worker scoring requests instead of reading mutable UI state. In `scoreRows`, always retain argmax `predicted`; append policy fields only when a multiclass policy exists. Imported-policy scoring is connected in Task 6 after v4 parsing exists.

- [ ] **Step 4: Update batch UI**

Show decided/abstained counts and coverage separately from unknown labels. Preview both raw and policy decisions; render “no decision” for abstentions.

- [ ] **Step 5: Add Playwright coverage**

After freezing a policy, score the iris batch demo and assert the result panel reports coverage and the downloaded CSV action remains available.

- [ ] **Step 6: Run score and focused e2e tests**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npx vitest run src/features/ml/train/score.test.ts`

Run: `npx playwright test e2e/imbalance.spec.ts`

Expected: all tests PASS and binary/regression batch tests retain their old CSV headers.

- [ ] **Step 7: Commit policy-aware batch scoring**

```powershell
git add src/features/ml/train/score.ts src/features/ml/train/score.test.ts src/features/ml/components/BatchScorePanel.tsx src/features/ml/lab-store.ts src/features/ml/data/parse.worker.ts src/features/ml/worker-protocol.ts src/locales/fr.json src/locales/en.json e2e/imbalance.spec.ts
git commit -m "feat(ml): apply multiclass policy to batches"
```

### Task 6: Model Export Format v4

**Files:**

- Modify: `src/features/ml/train/serialize.ts`
- Modify: `src/features/ml/train/deserialize.ts`
- Modify: `src/features/ml/train/serialize.test.ts`
- Modify: `src/features/ml/train/deserialize-hostile.test.ts`
- Modify: `src/features/ml/data/parse.worker.ts`
- Modify: `src/features/ml/worker-protocol.ts`
- Modify: `src/features/ml/components/ImportModelPanel.tsx`

**Interfaces:**

- Consumes: Task 1 `MulticlassDecisionPolicy`; Task 4 frozen run artifact.
- Produces:
  - `serializeModel(..., decisionPolicy?: MulticlassDecisionPolicy): string | null`
  - `ImportedManifest.decisionPolicy?: MulticlassDecisionPolicy`
  - v4 JSON field `decisionPolicy` only when a frozen multiclass policy exists.

- [ ] **Step 1: Write failing v4 round-trip tests**

Update `serialize.test.ts` to expect `formatVersion: 4`. Assert a policy survives export/import and produces byte-identical policy-aware batch CSV between live and rebuilt models. Construct v2, v3, and v4-without-policy manifests and assert all retain historical argmax scoring and old CSV shape.

- [ ] **Step 2: Add hostile-manifest tests**

In `deserialize-hostile.test.ts`, assert wrong threshold count, non-finite values, values outside `[0, 1]`, and policy on a regression manifest throw `bad-manifest`.

- [ ] **Step 3: Run serialization tests and verify they fail**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npx vitest run src/features/ml/train/serialize.test.ts src/features/ml/train/deserialize-hostile.test.ts`

Expected: FAIL because format v4 and policy parsing do not exist.

- [ ] **Step 4: Implement v4 export/import**

Accept versions 2, 3, and 4. Validate optional v4 policy against the class list before returning it in `ImportedManifest`. Do not synthesize a zero policy for older files; absence is what preserves their exact historical output.

- [ ] **Step 5: Thread policy through export and imported batch scoring**

The worker reads the latest frozen `RunArtifacts.multiclassDecision.policy` when exporting and uses `ImportedManifest.decisionPolicy` when scoring an imported file. Show the imported policy and abstention capability in `ImportModelPanel`.

- [ ] **Step 6: Run serialization, scoring, and hostile-input tests**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npx vitest run src/features/ml/train/serialize.test.ts src/features/ml/train/deserialize-hostile.test.ts src/features/ml/train/score.test.ts`

Expected: all tests PASS.

- [ ] **Step 7: Commit format v4**

```powershell
git add src/features/ml/train/serialize.ts src/features/ml/train/deserialize.ts src/features/ml/train/serialize.test.ts src/features/ml/train/deserialize-hostile.test.ts src/features/ml/data/parse.worker.ts src/features/ml/worker-protocol.ts src/features/ml/components/ImportModelPanel.tsx
git commit -m "feat(ml): export multiclass policy in model v4"
```

### Task 7: Delivery Record and Full Verification

**Files:**

- Modify: `PLAN.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`

**Interfaces:**

- Consumes: all previous tasks and their measured test totals.
- Produces: V45 marked delivered, generated changelog entry, product version `1.45.0`, and current verification counts.

- [ ] **Step 1: Run the complete pre-delivery suite**

Run:

```powershell
npm run lint
npm run format:check
npm run typecheck
$env:NODE_OPTIONS='--no-experimental-webstorage'; npm run test
npm run build
npx playwright test
```

Expected: zero errors and zero failing tests. Record the actual Vitest and Playwright counts.

- [ ] **Step 2: Update V45's delivery record**

Change `V45 — pending` to `V45 — delivered`, remove the sentence forbidding implementation, and append the measured unit/e2e totals. Keep the exclusions and the approved rationale intact.

- [ ] **Step 3: Generate changelog and version**

Run: `npm run changelog`

Expected: `CHANGELOG.md` gains V45 and both package manifests move from `1.44.0` to `1.45.0`.

- [ ] **Step 4: Update README verification counts**

Replace the prior unit and Playwright totals with the exact counts recorded in Step 1; do not estimate.

- [ ] **Step 5: Re-run delivery contracts**

Run:

```powershell
npx prettier --check PLAN.md CHANGELOG.md README.md package.json package-lock.json
$env:NODE_OPTIONS='--no-experimental-webstorage'; npx vitest run src/lib/changelog.test.ts src/lib/platform-limits.test.ts
```

Expected: all checks PASS; changelog and version match the delivered plan; Cloudflare file limits remain satisfied.

- [ ] **Step 6: Commit delivery metadata**

```powershell
git add PLAN.md CHANGELOG.md README.md package.json package-lock.json
git commit -m "docs: record V45 delivery"
```

- [ ] **Step 7: Review the complete branch**

Run:

```powershell
git status --short
git --no-pager diff --check origin/main...HEAD
git --no-pager log --oneline origin/main..HEAD
```

Expected: clean worktree, no whitespace errors, and one focused commit per task.

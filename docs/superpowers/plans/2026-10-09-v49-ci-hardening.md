# V49: CI that cannot be steered by a branch name

## Baseline

zizmor 1.30.1, offline, on `.github/workflows`:

| Finding            | Count | Where                                   |
| ------------------ | ----- | --------------------------------------- |
| template-injection | 1     | `ci.yml` deploy step, `github.head_ref` |
| unpinned-uses      | 21    | every `uses:` in the three workflows    |
| artipacked         | 6     | every `actions/checkout` step           |

After this wave: 0 findings.

## Changes

1. The deploy branch reaches the shell through `env: DEPLOY_BRANCH`, never
   through `${{ }}` inside `run:`.
2. Every action is pinned to a commit SHA with its release as a trailing
   comment. Dependabot (`github-actions` ecosystem, already weekly) updates
   both.
3. Every checkout sets `persist-credentials: false`. No job pushes.
4. New CI job `Workflow audit (zizmor)`: `pipx run zizmor==1.30.1` with
   `GH_TOKEN`, so the online audits (impostor commits, ref confusion) run too.
   They could not be run from the development container, whose proxy blocks
   zizmor's API calls; the first CI run is their verification.
5. `npm run test:coverage` in CI, V8 provider, floors from the measured
   baseline rounded down: 64 / 53 / 54 / 65 (statements, branches, functions,
   lines).

## Tests

`src/lib/supply-chain.test.ts` gains three rules per workflow file. Run against
the workflows before this wave: 8 of 13 tests fail. After: 13 of 13 pass.

## Not done

A coverage target, e2e coverage instrumentation, and making deploys wait on the
audit job.

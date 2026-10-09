# V51: a store that fits on a screen

## Rule

No behaviour change. The proof is the suite: 906 unit tests and 97 Chromium
e2e tests pass unchanged before and after.

## Changes

| Before                                 | After                                                      |
| -------------------------------------- | ---------------------------------------------------------- |
| `lab-store.ts`, 1 050 lines            | 530 lines: actions only, public names re-exported          |
| 250-line `onmessage` `if / else` chain | `store/responses.ts`, one typed entry per `WorkerResponse` |
| State shape and initial values inline  | `store/state.ts`                                           |
| V47 fence inline                       | `store/fence.ts`                                           |
| `thresholdArtifact` inside the closure | `store/artifacts.ts` (pure)                                |
| `v35` … `v40` test files               | named after what they pin                                  |
| Helpers copied in drift and reference  | `quality/distribution.ts`                                  |

The dispatch table is a mapped type over `WorkerResponse['kind']`: a missing
or extra handler is a compile error. The old chain's final `else` handled any
unlisted kind as `error` without saying so.

## Coverage gate

Branches became functions: 2 142 → 2 174 functions, floor 54 % failed at
53.72 %. Answered with `store/responses.test.ts` (17 cases pinning the fields
each state-only answer writes), not by lowering the floor. Result: 54.46 %.

## Not done

Feature slices (the actions share one worker and one `send`), splitting the
mixed `v35`/`v36` test files, unifying the two quantile functions (they differ
on an empty list: 0 vs NaN).

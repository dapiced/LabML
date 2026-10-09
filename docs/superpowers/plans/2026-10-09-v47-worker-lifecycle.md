# V47 — Workers that cannot answer the wrong question

## Why

The post-V46 audit (09/10/2026) found the whole suite green and still found
defects, because none of them lives inside one function. They live in the
conversation between a store and its worker, which no unit test exercised.

The worst one wrote wrong data without a warning: train on titanic, change the
target while the run is going, and the auto-save recorded the new target beside
the old scores.

## Scope

| Defect                                       | Where                                      | Fix                                                                                                              |
| -------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Target or features changed mid-run           | `lab-store.ts` `setTarget`, `toggleColumn` | `isTrainingBusy` guard in the store, controls disabled in `TargetPicker` and `ColumnCard`                        |
| Late worker answers applied to a reset state | `lab-store.ts` `onmessage`                 | `isStaleResponse` fence: training stream only during a run, run-derived answers only once a run is done          |
| Cancel ignored during the parallel phase     | `train/parallel-run.ts`                    | Cancel flag polled every `CANCEL_POLL_MS` (100 ms), helpers terminated mid-fit                                   |
| ML worker crash leaves the page spinning     | `lab-store.ts` `onerror`                   | Terminate the dead worker, clear every busy flag                                                                 |
| Chat worker crash leaves « thinking » up     | `chat-store.ts` `onerror`                  | Same, and the local model is marked failed since it died with the worker                                         |
| DuckDB engine never closed                   | `SqlPanel.tsx`, `sql/engine.ts`            | Close on unmount, on a late start and on failure; terminate the worker when start fails; `dropFile` in `finally` |
| Webcam stream granted after leaving the page | `VisionPage.tsx`                           | Stop the tracks on arrival when the page is gone                                                                 |

## Proof

Each test below was run against the original code first and failed there:

- `src/features/ml/lab-store.test.ts`: 6 of 7 fail before the fix (the 7th pins
  what the fence must never drop).
- `src/features/ml/train/parallel-run.test.ts`: times out before the fix.
- `src/features/data/SqlPanel.test.tsx`: both fail before the fix.
- `src/features/ai/chat/chat-store.test.ts`: fails before the fix.
- `e2e/train.spec.ts`: the target picker and column buttons are disabled for
  the whole run, and enabled again once it is done.

## Design choice: a fence, not a run id

The ML worker processes requests in the order it receives them and answers in
that order, so the store's training status is enough to tell a late answer
from a current one. A run id threaded through every request and response would
be more general and would touch every message in the protocol. It becomes
necessary the day requests can overlap; until then it is code without a defect
to prevent.

## What this wave deliberately does not do

Add a run id to the protocol, make analyses cancellable that are not cancellable
today, or harden share-link validation (V48).

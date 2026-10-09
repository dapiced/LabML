# Real share links

Three share payloads captured from the running app on 09/10/2026 (V48), decoded
from the `#` fragment that « Copy share link » produced:

| File           | Run                         | Analyses carried                                 |
| -------------- | --------------------------- | ------------------------------------------------ |
| `titanic.json` | titanic · survived (binary) | uncertainty, threshold, segments                 |
| `iris.json`    | iris · species (multiclass) | uncertainty, threshold, k-NN tuning, exploration |
| `mpg.json`     | mpg · mpg (regression)      | uncertainty, segments                            |

They contain metrics and charts only, never rows of data, exactly like the
links themselves. `src/features/ml/pages/SharedRunPage.test.tsx` deletes,
nulls and retypes every field of each one and asserts that the page always
ends on the run or on a refusal, never on a crash.

To refresh them after a format change, train the same three demos, copy each
share link, and decode the fragment with `lz-string`'s
`decompressFromEncodedURIComponent`.

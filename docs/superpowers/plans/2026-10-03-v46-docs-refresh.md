# V46 — The documentation catches up with V41 through V45

## Why

Five waves shipped without the documentation following. The gap is not
cosmetic: `/docs/formats` published an export manifest that no longer matched
`serializeModel`, and nothing on the site explained the multiclass decision
policy shipped in V45 — neither the thresholds, nor the abstention, nor the two
extra columns a scored CSV now carries.

A reference page that describes a format the code does not produce is worse
than a missing page. It is read as authoritative.

## Scope

Four page pairs, both languages, plus the README.

| Page                              | What changes                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formats`                         | Real v4 manifest, the five named refusals, the `decisionPolicy` block and its validity conditions, the decision columns                           |
| `reference-ml`                    | New section on deciding across several classes; the export section mentions the frozen policy                                                     |
| `scorer-un-lot` / `score-a-batch` | The `policy_decision` and `decision_status` columns, and what an empty cell means                                                                 |
| `limites` / `limits`              | Four rows added to "set aside by choice": V41 i18n boundaries, V43 boundary reach and telemetry, V44 Dependabot cadence, V45 automatic thresholds |
| `README.md`                       | The imbalance row names the multiclass policy                                                                                                     |

## Ground truth

Taken from the code, not from the previous wave's prose:

- `serialize.ts` — exact key order and the conditional `decisionPolicy`.
- `deserialize.ts` — the four conditions under which a policy is accepted, and
  the `bad-manifest` refusal when any fails.
- `score.ts` — the scored CSV header, and the empty `policy_decision` cell on
  abstention.
- `multiclass-decision.ts` — candidate rule, normalized margin, stable tie-break,
  explicit abstention, and all-zero thresholds reproducing argmax.

## Constraints the guards impose

- No wall-clock duration anywhere under `src/content/docs/`, code blocks
  included.
- Every figure in `REFERENCE_FACTS` and `TRACEABLE` stays where it is.
- Each page still ends on "Et ensuite ?" / "Where to go next" followed by an
  internal link.
- Slugs stay paired across the two languages.

## What this wave deliberately does not do

Rewrite the tutorial, add a page, translate the changelog, or re-litigate any
decision already recorded in the limits pages. Documentation only — no source
file under `src/features/` changes.

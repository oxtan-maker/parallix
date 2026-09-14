# CP-1: Trace the draft-start classification path and confirm the FAIL emission site

## Work done
Traced the draft-start classification path end to end and confirmed the premature
`[FAIL]` is emitted only from the scaffold step's call to `validateDraftClassification`.

- `validateDraftClassification` (`src/adapters/cli/commands/draft-prompts.ts:72`) prints
  `fmt.status('FAIL', classificationError)` when the resolver returns no classification,
  then returns `{ ok: true, classification: null }` — so the scaffold step is non-blocking.
- `grep` of every caller of `validateDraftClassification` shows the only invocation is the
  scaffold step in `src/adapters/cli/commands/draft-stats.ts:443`
  (`const classificationCheck = validateDraftClassificationFn(...)`). The hard gate is a
  separate helper, `normalizeDraftClassification` (`draft-prompts.ts`), invoked only from the
  `postProcess` step at `draft-stats.ts:596` and returning `{ ok: false }` → `safeExit`.
- The resolver is `stats.resolveMissionClassification` (`src/adapters/cli/commands/stats.ts:422`),
  which returns the `Missing or invalid classification …` error for a task with no valid label.
- Ruled out other callers: preflight resolves the task but does not classify; no other draft
  step calls `validateDraftClassification`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| FAIL emission site is the scaffold `validateDraftClassification` call | `src/adapters/cli/commands/draft-stats.ts` (scaffold step) | PASS |
| No other draft caller emits the premature classification FAIL | `src/adapters/cli/commands/draft-prompts.ts` `validateDraftClassification` single call site | PASS |
| Post-process hard gate preserved | `ADR 0048` (`docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md`), `normalizeDraftClassification` at `test/draft.test.ts` `"draft classification helpers fall back to stats when an injected resolver is invalid"` | PASS |

Next action: CP-2 — suppress the premature FAIL at the scaffold call site and add a red-to-green test.

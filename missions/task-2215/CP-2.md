# CP-2: Classifier recognizes auto-remediation failure as MissingArtifacts (task-2215)

## Summary

Added the `"even after auto-remediation"` pattern to `classifyError` in `lib/commands/repair-handoff.ts` as the leading disjunct of the MissingArtifacts pattern group (pattern 8). The auto-remediation handoff failure now classifies as `MissingArtifacts` → `AutoSendBack` per ADR 0048 instead of falling through to the default `InfraBlocker`/`HumanOnly`. No new failure classes or dispatch actions were added; the dispatch table is untouched.

Added the regression test `classifyError recognizes auto-remediation failure as MissingArtifacts` to `test/repair-handoff.test.js` using the exact message shape emitted by `performHandoff`.

Verified with `node --test test/task-2215-missing-error-bounce.test.js test/repair-handoff.test.js`: the classifier repro test turned green, all pre-existing `classifyError` / `isRelaunchableError` / `buildRelaunchPrompt` / `repairHandoff` tests still pass (60 passing). Only the CP-3 evidence-template repro remains red, as expected at this checkpoint.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| classifyError maps auto-remediation failure to MissingArtifacts/AutoSendBack (SC1) | lib/commands/repair-handoff.ts:124, "task-2215 repro: classifyError classifies auto-remediation checkpoint failure as MissingArtifacts/AutoSendBack" | PASS |
| Regression test added to the classifier suite | "classifyError recognizes auto-remediation failure as MissingArtifacts", test/repair-handoff.test.js | PASS |
| No regression in the 8-class dispatch table (SC3) | `node --test test/repair-handoff.test.js` — 0 failures; "classifyError returns InfraBlocker(HumanOnly) for unknown error" still passes | PASS |
| Pattern aligns with ADR dispatch prescription | ADR 0048 | PASS |

Next action: CP-3 — replace the `handoff.js` reference in `buildAutoCheckpointContent` (`lib/commands/handoff.ts`) with a verifiable `lib/commands/handoff.ts:262` file:line citation so the generated CP-1.md passes `findUnverifiableGoalCheckRow`, turning the remaining repro test green.

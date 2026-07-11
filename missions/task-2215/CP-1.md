# CP-1: Failing reproduction test for missing error bounce (task-2215)

## Summary

Authored the reproduction test `test/task-2215-missing-error-bounce.test.js` covering both defects:

1. **Classifier gap:** `classifyError` with the auto-remediation handoff error (`"No checkpoint documents found in ... even after auto-remediation. Implementation evidence is mandatory for review."`) currently returns `InfraBlocker`/`HumanOnly` instead of `MissingArtifacts`/`AutoSendBack` (ADR 0048).
2. **Unverifiable auto-checkpoint template:** `buildAutoCheckpointContent` emits an evidence row citing `handoff.js` (no `file:line`, file no longer exists), which `findUnverifiableGoalCheckRow` rejects.

To make the second path testable, added test seams in `lib/commands/handoff.ts` exposing `_buildAutoCheckpointContent`, `_findUnverifiableGoalCheckRow`, and `_collectGoalCheckEvidenceRows` on the module's named exports (no behavior change; the export block sits below line 262 so the auto-remediation flow's line references are unchanged).

Verified red at the pre-fix tree with `node --test test/task-2215-missing-error-bounce.test.js`:

- `task-2215 repro: classifyError classifies auto-remediation checkpoint failure as MissingArtifacts/AutoSendBack` — **FAIL**: actual `InfraBlocker`, expected `MissingArtifacts`.
- `task-2215 repro: buildAutoCheckpointContent evidence rows pass findUnverifiableGoalCheckRow validation` — **FAIL**: offending row `| Auto-generated checkpoint CP-1.md present | handoff.js auto-remediation creates CP-1.md when checkpoints.length === 0 | PASS |`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test exists at the mission-declared location | test/task-2215-missing-error-bounce.test.js | PASS |
| Classifier repro asserts MissingArtifacts/AutoSendBack per ADR 0048 | "task-2215 repro: classifyError classifies auto-remediation checkpoint failure as MissingArtifacts/AutoSendBack", ADR 0048 | PASS (red pre-fix: actual InfraBlocker) |
| Evidence-validation repro exercises the real validator via test seams | "task-2215 repro: buildAutoCheckpointContent evidence rows pass findUnverifiableGoalCheckRow validation", lib/commands/handoff.ts:1047 | PASS (red pre-fix: offending row cites handoff.js) |
| Auto-remediation error message source unchanged | lib/commands/handoff.ts:267 | PASS |

Next action: CP-2 — add the `"even after auto-remediation"` pattern to `classifyError` in `lib/commands/repair-handoff.ts` mapping to `MissingArtifacts`/`AutoSendBack`, then re-run the repro test to confirm the classifier assertion turns green.

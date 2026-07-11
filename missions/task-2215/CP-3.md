# CP-3: Auto-checkpoint template cites verifiable evidence (task-2215)

## Summary

Fixed `buildAutoCheckpointContent` in `lib/commands/handoff.ts` so the auto-generated CP-1.md evidence rows cite verifiable file:line references instead of the removed `handoff.js`:

- Row 1 now cites `lib/commands/handoff.ts:262` (the `fs.writeFileSync` call that performs the auto-remediation).
- Row 2 now cites `lib/commands/handoff.ts:47` (the `verifyHandoff` check that enforces MISSION.md presence).

Only the content template changed; the auto-checkpoint generation flow (handoff.ts lines 255-279) is untouched — line 262 remains the `writeFileSync` call because all edits sit below it.

Added the regression test `buildAutoCheckpointContent produces verifiable evidence rows` to `test/handoff.test.js`, which runs the generated template through the same `collectGoalCheckEvidenceRows` + `findUnverifiableGoalCheckRow` validation `performHandoff` applies.

Verified with `node --test test/task-2215-missing-error-bounce.test.js test/handoff.test.js`: 74 tests, 74 pass, 0 fail — both reproduction tests are now green and every pre-existing handoff test still passes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Auto-generated evidence rows pass findUnverifiableGoalCheckRow (SC2) | lib/commands/handoff.ts:854, "task-2215 repro: buildAutoCheckpointContent evidence rows pass findUnverifiableGoalCheckRow validation" | PASS |
| Regression test added to the handoff suite | "buildAutoCheckpointContent produces verifiable evidence rows", test/handoff.test.js | PASS |
| Auto-checkpoint generation flow unchanged (stop rule) | lib/commands/handoff.ts:262 — still the `fs.writeFileSync` auto-remediation call | PASS |
| No regression in the handoff suite (SC4) | `node --test test/handoff.test.js` — 74/74 pass including "performHandoff succeeds after successful agent relaunch" | PASS |

Next action: CP-4 — run `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all`, confirm zero failures, and record final gate evidence for handoff.

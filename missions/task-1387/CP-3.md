# CP-3: Preserve backward compatibility and verify all gates

## Summary

Confirmed backward compatibility: all existing `isRelaunchableError` / `isDirtyError` / `isBehind` paths in `repair-handoff.ts` and `runHandoffAndReview()` continue to work unchanged. The new gate-failure relaunch path is isolated from the existing repair/relaunch paths.

Round 1 review fix (Finding 1): Attached `gateOutput` to the declared-gate failure return value in `performHandoff()` (`lib/commands/handoff.ts:352`) and updated the SC3 declared-gate test to assert `gateOutput` reaches `attemptAgentRelaunch`.

Verification results:
- All 120 tests pass across `test/handoff.test.js` (33), `test/active.test.js` (72), and `test/repair-handoff.test.js` (15).
- Static analysis gate (`./scripts/verify-local.sh static-analysis`): ESLint 0 errors / 244 warnings (pre-existing), tsc typecheck clean, test-hygiene clean.
- Integration gate (`./scripts/verify-local.sh integrate`): integration:lib clean, integration:workflow clean (3 e2e tests pass).

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| SC5: Existing repair-handoff behavior preserved | `node --test test/repair-handoff.test.js` — 15 tests pass including `repairHandoff auto-commits safe mission files`, `repairHandoff refuses to commit when unsafe files are dirty`, `repairHandoff calls rebase when branch is behind`, `isRelaunchableError returns true/false` variants | PASS |
| SC5: Existing handoff tests pass | `node --test test/handoff.test.js` — 33 tests pass including all pre-existing tests for verifyHandoff, performHandoff, runDeclaredGates, captureNelAtHandoff | PASS |
| SC5: Existing active tests pass | `node --test test/active.test.js` — 72 tests pass including all pre-existing tests for buildExecutePrompt, runHandoffAndReview, selectLaunchAndRecord, enforceExecuteCommitSafety | PASS |
| SC6: Static analysis gate passes | `./scripts/verify-local.sh static-analysis` — ESLint: 0 errors, tsc: clean, test-hygiene: clean | PASS |
| SC6: Integration gate passes | `./scripts/verify-local.sh integrate` — integration:lib: PASS, integration:workflow: 3 e2e tests PASS | PASS |
| Round 1 Finding 1 fixed | `lib/commands/handoff.ts:352` now returns `gateOutput: { stdout, stderr }` for declared-gate failures; test/active.test.js:1579 asserts `lastGateOutput.stdout` and `lastGateOutput.stderr` reach `attemptAgentRelaunch` | PASS |

Next action: Commit all changes and hand off to review.

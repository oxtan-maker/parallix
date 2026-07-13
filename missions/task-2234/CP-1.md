# CP-1: Failing Reproduction Test

Created `test/task-2234-push-to-reviewer-autobounce.test.js` with 4 tests that reproduce the two defects identified in the mission:

1. **`runDeclaredGates` does not reject explanatory dash suffixes** — The extraction step at `lib/commands/handoff.ts:829` strips the em-dash/en-dash suffix before `validateDeclaredGates` sees the command, so `true — some description` becomes `true` and passes validation. Tests 1-2 are RED.

2. **`pushRound` does not auto-bounce on declared-gate validation failure** — When `createPr` fails with a `validation-failed` reason, the task remains stuck in `review` status with no automatic transition back to `active`. Test 3 is RED.

3. **Non-validation failures must NOT bounce** — Infrastructure errors (auth, network) correctly do not trigger auto-bounce. Test 4 is GREEN.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Gate entry with explanatory dash suffix is rejected as validation error | `test/handoff.test.js:1516` "runDeclaredGates rejects explanatory dash suffixes" — RED at parent commit | RED (pre-fix) |
| Reviewer-push blocked by invalid gate auto-bounces to repairable state | `test/task-2234-push-to-reviewer-autobounce.test.js:67` "pushRound auto-bounces task to active on declared-gate validation failure" — RED at parent commit | RED (pre-fix) |
| Regression test at `test/task-2234-push-to-reviewer-autobounce.test.js` is red against parent commit | `node --test test/task-2234-push-to-reviewer-autobounce.test.js` — 3 fail, 1 pass | RED (pre-fix) |
| Normal verification gate completes without focused/skipped tests | `test/task-2234-push-to-reviewer-autobounce.test.js` — no .only or .skip | PASS |

Next action: Fix `runDeclaredGates` in `lib/commands/handoff.ts` to check for dash suffix before stripping, and implement auto-bounce in `pushRound` in `lib/review/review-commands.ts` for declared-gate validation failures.

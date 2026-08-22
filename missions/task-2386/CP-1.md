# CP-1 — Watchdog liveness regression reproduction

Added a focused launcher-level regression test for an agent that emits visible
output, remains open, and must still receive periodic liveness reports. The
test is intentionally red against the pre-fix watchdog behavior, which clears
the timer after the first output.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction covers output followed by a still-running child | `test/spawn-tee.test.ts`, `"spawnAndTee continues liveness reports after visible output until the child settles"` | PASS |
| Reproduction is red before the watchdog fix | `npm test -- test/spawn-tee.test.ts` fails the new focused test on the committed pre-fix implementation | PASS |
| Test remains hermetic and launcher-level | `test/spawn-tee.test.ts` | PASS |

Next action: add the shared completion contract to the four in-scope agent prompts and assert the rebase prompt's required execution commands.

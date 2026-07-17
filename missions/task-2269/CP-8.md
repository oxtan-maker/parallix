# CP-8 — Remove residual launcher and timing dependencies

The review-remote push hook exposed two unit tests that passed alone but failed
under full-suite load. The review fallback tests now inject an in-memory launcher
and support probe instead of creating PATH executables. The bootstrap regression
now verifies `OPENCODE_BIN` isolation in a short child process without launching
an agent, sleeping, sending signals, or racing a timeout.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Review fallback unit coverage does not discover or execute workstation launchers | `test/task-1036-review-fallback.test.js`, `fakeLauncher` | PASS |
| Operator `OPENCODE_BIN` cannot escape the unit bootstrap | `test/task-2231-unit-tests-hang-repro.test.js`, `test/bootstrap-parallix-home.js` | PASS |
| Timing and process-signal behavior are absent from the bootstrap isolation regression | `test/task-2231-unit-tests-hang-repro.test.js` | PASS |
| Focused isolation coverage is repeatable under the unit bootstrap | `node --require ./test/bootstrap-parallix-home.js --test test/task-1036-review-fallback.test.js test/task-2231-unit-tests-hang-repro.test.js` (10 consecutive runs) | PASS |
| Required static-analysis gate passes | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: checkpoint the deterministic unit-test repairs and resubmit task-2269 to Forgejo review.

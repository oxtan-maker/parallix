# CP-3: Interruption-safe fixture cleanup

Added detached, test-owned watchdogs for the two affected fixture roots. Each watcher waits only for the process that owns its fixture; if that process disappears, it removes the known e2e worktree before deleting its temporary repository, or deletes the known review fixture root. The existing `finally` blocks remain in place for normal completion, assertion failure, and thrown errors, so ordinary failures retain their original errors instead of being replaced by cleanup faults.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: regression has a cleanup implementation to verify | `test/task-2212-repro.test.js:19`; `test/task-2212-repro.test.js:64` | Ready for green verification |
| SC2: e2e artifacts are cleaned only within their fixture root | `test/e2e-mission-lifecycle.test.js:361`; `test/e2e-mission-lifecycle.test.js:378` | Implemented |
| SC3: TASK-2198 fixture is cleaned only within its fixture root | `test/review.test.js:76`; `test/review.test.js:92`; `test/review.test.js:3196` | Implemented |
| SC4: normal assertion/error cleanup is retained | `test/e2e-mission-lifecycle.test.js:596`; `test/review.test.js:3232` | Implemented — `finally` seams retained |
| SC5: no focused or unannotated skipped test | `test/task-2212-repro.test.js` | Pending final test-hygiene verification |
| SC6: repository verifier passes | `./scripts/verify-local.sh all` | Pending CP5 |

Next action: Run the named interruption regression and the two owning tests to demonstrate that both cleanup paths are green.

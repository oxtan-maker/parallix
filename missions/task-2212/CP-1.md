# CP-1: Red regression locked

Added an isolated interruption regression for the feature-branch lifecycle. It starts the existing e2e scenario in a child process, waits for its test-owned worktree, kills that child, and checks the fixture repository for the leaked branch and worktree. On the mission parent state, the branch assertion is red: `feature/e2e-base` remains after the interrupted path. The test's own `finally` block removes its temporary fixture so this red run does not contaminate the developer checkout.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: named red-to-green regression covers the failed path | `test/task-2212-repro.test.js:19`; `"interrupted feature lifecycle leaves no e2e branch or worktree behind (SC1/SC2)"`; `node --test --test-reporter tap test/task-2212-repro.test.js` | Red — parent-state run reports `feature/e2e-base` |
| SC2: failed e2e path leaves no branch or worktree | `test/task-2212-repro.test.js:48`; `test/task-2212-repro.test.js:50` | Red — branch remains after SIGKILL |
| SC3: failed review path leaves no TASK-2198 fixture | `test/task-2212-repro.test.js:57`; `"interrupted review fixture leaves no TASK-2198 stale-active task behind (SC1/SC3)"`; `node --test --test-reporter tap test/task-2212-repro.test.js` | Red — TASK-2198 fixture remains after SIGKILL |
| SC4: cleanup preserves original test error | `test/e2e-mission-lifecycle.test.js:572` | Pending CP3 |
| SC5: no focused or unannotated skipped test | `test/task-2212-repro.test.js` | Pending final test-hygiene verification |
| SC6: repository verifier passes | `./scripts/verify-local.sh all` | Pending CP5 |

Next action: Trace the exact fixture ownership and cleanup seams in the e2e lifecycle and review tests before changing their teardown.

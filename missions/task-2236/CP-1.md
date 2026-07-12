# CP-1 — Reproduction locked

Added the requested regression test for the command-selection failure. Before the implementation, the test failed because `test/run-default-tests.js` discarded npm's positional test path and always excluded the real-agent smoke test. The red assertion now protects that e2e selection contract without calling a real model.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test exists at the mission-declared path | `test/task-2236-pi-e2e-repro.test.js:6` | PASS |
| Reproduction identifies the e2e-selection wiring defect | `test/task-2236-pi-e2e-repro.test.js:12` | PASS |
| Red failure was observed before the runner forwarding change | `test/task-2236-pi-e2e-repro.test.js`, `test/run-default-tests.js:7` | PASS |

Next action: update the default test runner to replace its default list with an explicitly requested e2e test path.

# CP-7 — Cross-machine review submission hardening

Removed the remaining workstation dependencies found by the real handoff gate. Unit
tests now fail on unmocked Forgejo access, command launchers use repository-controlled
executables, packaging stays in disposable directories, and verification gates inherit
the caller's Node/PATH instead of loading machine-specific login profiles. The two E2E
layers retain real Parallix rails, with the real-agent smoke now continuing through
integration.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Unit tests reject real Forgejo and non-version curl access | `test/bootstrap-parallix-home.js:27`, `test/mission-start.test.js:182` | PASS |
| Default unit runner excludes both explicit E2E layers | `test/run-default-tests.js:35`, `test/run-default-tests.js:51` | PASS |
| Deterministic lifecycle E2E uses real CLI/Git rails with controlled agents | `test/e2e-mission-lifecycle.test.js:262`, `node test/run-default-tests.js test/e2e-mission-lifecycle.test.js` | PASS |
| Real-agent smoke exercises integration and completed-task cleanup | `test/e2e-real-agent-smoke.test.js:850` | PASS |
| Verification avoids login-profile Node/PATH mutation | `lib/core/verification.ts:169`, `test/verification.test.js:108` | PASS |
| Packaging round-trip writes only beneath its disposable pack directory | `test/task-1424-post-integrate-publish-reinstall.test.js:59`, `node test/run-default-tests.js test/task-1424-post-integrate-publish-reinstall.test.js` | PASS |
| Interrupted E2E cleanup completes without arbitrary timeout increases | `test/task-2212-repro.test.js:16`, `node test/run-default-tests.js test/task-2212-repro.test.js` | PASS |
| Required static-analysis gate passes | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: create the local checkpoint commit and submit task-2269 for review.

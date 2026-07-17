# CP-6 — Deterministic unit-test runtime isolation

Extended the mission to cover host-dependent unit-test failures discovered during
the review gate. Unit fixtures now use controlled launcher scripts and provider
doubles; the integration-only real-agent smoke lifecycle is not changed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Unit tests do not discover workstation agent CLIs | `test/bootstrap-parallix-home.js:91`, `test/lib/agent-script-runner.js:13`, `test/agents.test.js:121` | PASS |
| Unit tests fail closed when an availability mock is omitted | `lib/tools/forgejo.ts:1472`, `test/bootstrap-parallix-home.js:19` | PASS |
| Forgejo API/configuration tests use explicit deterministic doubles | `test/forgejo.test.js:126`, `node test/run-default-tests.js test/forgejo.test.js` | PASS |
| macOS temporary-path aliases preserve fixture identity | `test/task_1004.test.js:36`, `test/mission-utils-paths.test.js:25`, `test/mission-utils-worktree.test.js:24` | PASS |
| Focused agent, Forgejo, verification, and path suites pass | `test/agents.test.js:121`, `test/forgejo.test.js:102`, `test/mission-utils-paths.test.js:39` | PASS |
| Static-analysis test typecheck status | `./scripts/verify-local.sh static-analysis` reports existing mock-signature errors at `test/review.test.js:983` | BLOCKED |

Next action: commit the mission-scope extension and rerun `node px.ts review --submit`.

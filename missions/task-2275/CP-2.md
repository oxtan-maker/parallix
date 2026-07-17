# CP-2: Route real-boundary coverage

Added `npm run test:integration`, backed by `test/run-default-tests.js`.
The runner preserves root-level real-boundary tests and invokes them through
that explicit command when a test uses a process, Git/worktree, package, or
network marker. It also names the measured workflow-fixture groups whose
dependency-injected launchers still made them integration-duration tests:
`draft.test.js`, `draft-command.test.js`, `draft_preflight_modern.test.js`,
`durable-state-policy.test.js`, and `mission-start.test.js`.

The default-runner regression test proves that the E2E exclusions, boundary
selector, integration mode, and package command exist. Existing real-agent and
lifecycle E2E commands remain unchanged in `config/integration-pipelines.json`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Baseline records command, conditions, durations, and total | `missions/task-2275/CP-1.md`, `npm test` | PARTIAL |
| Every captured >1,000 ms test is inventoried and classified | `test/draft-command.test.js`, `"runDraftCommand top-level flows are covered with injected dependencies"`, `test/mission-start.test.js` | PASS |
| Boundary-dependent default coverage has a named later destination | `test/run-default-tests.js:43`, `npm run test:integration` | PASS |
| Moved groups prove exclusion and inclusion routing | `test/default-test-suite.test.js`, `"default test runner leaves boundary and E2E suites to explicit integration commands"` | PASS |
| Retained default tests have no real process/repository/package/network/agent dependency | `test/run-default-tests.js:42` | IN PROGRESS |
| Final timing and remaining >1,000 ms justification are recorded | `npm test` | IN PROGRESS |
| General, static-analysis, and integration gates pass | `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh integrate` | PENDING |

Next action: rerun `npm test` after the expanded measured-group routing and capture any remaining over-one-second test names before final gate verification.

# CP-5: Prove failure propagation and suite routing

Added a strict injected-runner regression test that returns exit 23 for the exact `npm run test:integration` command and fails if a simulated squash command is requested afterward. It proves the runner stops at the integration-suite gate without invoking any real command, agent, service, nested `px`, or verifier. The routing regression test continues to enumerate every boundary suite selected by the explicit integration command and rejects any expected boundary suite that remains in the default test run.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| TypeScript lifecycle harness matches the pre-task-2276 behavior | `test/e2e-mission-lifecycle.test.ts:13`; `node --import tsx test/e2e-mission-lifecycle.test.ts` | PASS |
| TypeScript real-agent harness matches the pre-task-2276 behavior | `test/e2e-real-agent-smoke.test.ts:28`; `PARALLIX_REAL_AGENT=codex PARALLIX_REAL_AGENT_MODEL=gpt-5.6-luna node --import tsx test/e2e-real-agent-smoke.test.ts` | PASS |
| Both restored E2E gates run on the implementation tree | `npm run build`; `test/e2e-mission-lifecycle.test.ts`; `test/e2e-real-agent-smoke.test.ts` | PASS |
| Real-agent smoke uses the supported Codex model override | `test/e2e-real-agent-smoke.test.ts:37`; `PARALLIX_REAL_AGENT=codex PARALLIX_REAL_AGENT_MODEL=gpt-5.6-luna node --import tsx test/e2e-real-agent-smoke.test.ts` | PASS |
| Every representative resolved plan contains the named exact integration-suite command | `config/integration-pipelines.json:15`; `"every representative changed-area plan includes the unconditional integration-suite gate (task-2292)"` | PASS |
| Representative plans preserve distinct workflow and custom-agent-smoke gates | `test/integration-pipelines.test.ts:1347`; `config/integration-pipelines.json:26` | PASS |
| A nonzero integration-suite result blocks the simulated squash command | `test/integration-pipelines.test.ts:289`; `"integration-suite failure aborts before a simulated squash merge command (task-2292)"` | PASS |
| Explicit integration routing covers every non-E2E default-suite exclusion | `test/default-test-suite.test.ts:76`; `"default test runner routes every moved group to integration and excludes it from default"` | PASS |
| New unit coverage remains hermetic | `test/integration-pipelines.test.ts:289`; `node --import tsx --test test/integration-pipelines.test.ts` | PASS |
| Focused, integration, general, and static-analysis verification pass | `npm run test:integration`; `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis` | PENDING CP-6 |

Next action: Run the full mission-declared verification matrix, then record final command and test evidence in CP-6.

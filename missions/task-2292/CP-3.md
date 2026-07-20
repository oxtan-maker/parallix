# CP-3: Capture the integration-suite omission reproduction

Added the required red reproduction before changing the integration plan. It resolves the repository configuration for `lib`, `workflow`, `docs`, backlog-only, mission-artifact-only, unknown-path, and no-area inputs and requires the named `integration-suite` command. On the pre-fix configuration it fails immediately for the `lib` case because that gate does not yet exist; the test will be rerun green after the resolver/configuration repair.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| TypeScript lifecycle harness matches the pre-task-2276 behavior | `test/e2e-mission-lifecycle.test.ts:13`; `node --import tsx test/e2e-mission-lifecycle.test.ts` | PASS |
| TypeScript real-agent harness matches the pre-task-2276 behavior | `test/e2e-real-agent-smoke.test.ts:28`; `PARALLIX_REAL_AGENT=codex PARALLIX_REAL_AGENT_MODEL=gpt-5.6-luna node --import tsx test/e2e-real-agent-smoke.test.ts` | PASS |
| Both restored E2E gates run on the implementation tree | `npm run build`; `test/e2e-mission-lifecycle.test.ts`; `test/e2e-real-agent-smoke.test.ts` | PASS |
| Real-agent smoke uses the supported Codex model override | `test/e2e-real-agent-smoke.test.ts:37`; `PARALLIX_REAL_AGENT=codex PARALLIX_REAL_AGENT_MODEL=gpt-5.6-luna node --import tsx test/e2e-real-agent-smoke.test.ts` | PASS |
| Resolved plan includes an unconditional named integration-suite gate | `test/integration-pipelines.test.ts:1323`; `"every representative changed-area plan includes the unconditional integration-suite gate (task-2292)"` | RED: expected before CP-4 |
| Representative plans preserve distinct workflow and custom-agent-smoke gates | `test/integration-pipelines.test.ts`; `config/integration-pipelines.json:20` | PENDING CP-4 |
| Explicit integration routing covers every non-E2E default-suite exclusion | `test/run-default-tests.js`; `test/default-test-suite.test.ts` | PENDING CP-5 |
| New unit coverage remains hermetic | `test/integration-pipelines.test.ts:1323` | PASS |
| Focused, integration, general, and static-analysis verification pass | `npm run test:integration`; `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis` | PENDING CP-6 |

Next action: Add the unconditional `integration-suite` configuration entry and update `lib/commands/integrate.ts` so no-area plans retain it.

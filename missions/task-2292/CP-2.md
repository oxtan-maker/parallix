# CP-2: Run the restored E2E defenses

Built the implementation tree, then ran both baseline-confirmed TypeScript E2E harnesses. The lifecycle suite passed. The real-agent smoke suite passed using only the supported `codex` / `gpt-5.6-luna` override. The direct pre-build failure recorded in CP-1 is the harness's documented source-tree prerequisite, not a TypeScript behavioral divergence: both historical and current harnesses execute the compiled `dist/px.js` entry point.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| TypeScript lifecycle harness matches the pre-task-2276 behavior | `test/e2e-mission-lifecycle.test.ts:13`; `node --import tsx test/e2e-mission-lifecycle.test.ts` | PASS |
| TypeScript real-agent harness matches the pre-task-2276 behavior | `test/e2e-real-agent-smoke.test.ts:28`; `PARALLIX_REAL_AGENT=codex PARALLIX_REAL_AGENT_MODEL=gpt-5.6-luna node --import tsx test/e2e-real-agent-smoke.test.ts` | PASS |
| Both restored E2E gates run on the implementation tree | `npm run build`; `test/e2e-mission-lifecycle.test.ts`; `test/e2e-real-agent-smoke.test.ts` | PASS |
| Real-agent smoke uses the supported Codex model override | `test/e2e-real-agent-smoke.test.ts:37`; `PARALLIX_REAL_AGENT=codex PARALLIX_REAL_AGENT_MODEL=gpt-5.6-luna node --import tsx test/e2e-real-agent-smoke.test.ts` | PASS |
| Resolved plan includes an unconditional named integration-suite gate | `config/integration-pipelines.json`; `test/integration-pipelines.test.ts` | PENDING CP-3/CP-4 |
| Representative plans preserve distinct workflow and custom-agent-smoke gates | `test/integration-pipelines.test.ts`; `config/integration-pipelines.json:20` | PENDING CP-4 |
| Explicit integration routing covers every non-E2E default-suite exclusion | `test/run-default-tests.js`; `test/default-test-suite.test.ts` | PENDING CP-5 |
| New unit coverage remains hermetic | `test/integration-pipelines.test.ts`; `test/verify-local-integrate.test.ts` | PENDING CP-5 |
| Focused, integration, general, and static-analysis verification pass | `npm run test:integration`; `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis` | PENDING CP-6 |

Next action: Add the CP-3 red reproduction for an integration-suite gate in documentation, backlog/mission-artifact, unknown, and no-area plans.

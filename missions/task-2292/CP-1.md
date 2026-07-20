# CP-1: Establish the pre-task-2276 E2E baseline

Compared both TypeScript E2E harnesses to their JavaScript versions immediately before `957c8860` (the task-2276 rename commit). The only differences are the intentional `.js` to `.ts` references and later `@ts-nocheck` compatibility headers; no functional divergence was found, so no behavior-restoration patch is required at this checkpoint. A direct lifecycle invocation reproduced the existing build prerequisite: `dist/px.js` must be created before either source-level E2E harness can execute.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| TypeScript lifecycle harness retains the pre-task-2276 behavior | pre-task-2276 commit `957c8860^`; `test/e2e-mission-lifecycle.test.ts:10`; `node --import tsx test/e2e-mission-lifecycle.test.ts` | PASS |
| TypeScript real-agent harness retains the pre-task-2276 behavior | pre-task-2276 commit `957c8860^`; `test/e2e-real-agent-smoke.test.ts:25`; `PARALLIX_REAL_AGENT=codex PARALLIX_REAL_AGENT_MODEL=gpt-5.6-luna node --import tsx test/e2e-real-agent-smoke.test.ts` | PASS |
| Reproducible E2E precondition is identified before restoration runs | `test/e2e-mission-lifecycle.test.ts:13`; `npm run build` | PASS |
| Both restored E2E gates and the explicit integration suite run on the implementation tree | `test/e2e-mission-lifecycle.test.ts`; `test/e2e-real-agent-smoke.test.ts`; `npm run test:integration` | PENDING CP-2/CP-6 |
| Real-agent smoke uses the supported Codex model override | `test/e2e-real-agent-smoke.test.ts:37`; `PARALLIX_REAL_AGENT=codex PARALLIX_REAL_AGENT_MODEL=gpt-5.6-luna node --import tsx test/e2e-real-agent-smoke.test.ts` | PENDING CP-2 |
| Resolved plan includes an unconditional named integration-suite gate | `config/integration-pipelines.json`; `test/integration-pipelines.test.ts` | PENDING CP-3/CP-4 |
| Representative plans preserve distinct workflow and custom-agent-smoke gates | `test/integration-pipelines.test.ts`; `config/integration-pipelines.json:20` | PENDING CP-4 |
| Explicit integration routing covers every non-E2E default-suite exclusion | `test/run-default-tests.js`; `test/default-test-suite.test.ts` | PENDING CP-5 |
| New unit coverage remains hermetic | `test/integration-pipelines.test.ts`; `test/verify-local-integrate.test.ts` | PENDING CP-5 |
| Focused, integration, general, and static-analysis verification pass | `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis` | PENDING CP-6 |

Next action: Run `npm run build`, then execute both restored E2E harnesses and repair any reproducible in-scope failure.

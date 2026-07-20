# CP-4: Make the integration suite an unconditional resolved gate

Added the named `integration-suite` gate with the exact `npm run test:integration` command. The resolver now supports explicit `always` gates. For a no-area plan it retains only unconditional defenses, while configurations with no such declaration retain their legacy empty-area behaviour. The focused planner test is green for every required changed-area class and verifies the independently scheduled E2E gates remain selected, ordered, and commanded only for their current `lib`/`workflow` areas.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| TypeScript lifecycle harness matches the pre-task-2276 behavior | `test/e2e-mission-lifecycle.test.ts:13`; `node --import tsx test/e2e-mission-lifecycle.test.ts` | PASS |
| TypeScript real-agent harness matches the pre-task-2276 behavior | `test/e2e-real-agent-smoke.test.ts:28`; `PARALLIX_REAL_AGENT=codex PARALLIX_REAL_AGENT_MODEL=gpt-5.6-luna node --import tsx test/e2e-real-agent-smoke.test.ts` | PASS |
| Both restored E2E gates run on the implementation tree | `npm run build`; `test/e2e-mission-lifecycle.test.ts`; `test/e2e-real-agent-smoke.test.ts` | PASS |
| Real-agent smoke uses the supported Codex model override | `test/e2e-real-agent-smoke.test.ts:37`; `PARALLIX_REAL_AGENT=codex PARALLIX_REAL_AGENT_MODEL=gpt-5.6-luna node --import tsx test/e2e-real-agent-smoke.test.ts` | PASS |
| Every representative resolved plan contains the named exact integration-suite command | `config/integration-pipelines.json:15`; `lib/commands/integrate.ts:421`; `"every representative changed-area plan includes the unconditional integration-suite gate (task-2292)"` | PASS |
| Representative plans preserve distinct workflow and custom-agent-smoke gates | `config/integration-pipelines.json:26`; `test/integration-pipelines.test.ts:1323`; `"every representative changed-area plan includes the unconditional integration-suite gate (task-2292)"` | PASS |
| Explicit integration routing covers every non-E2E default-suite exclusion | `test/run-default-tests.js`; `test/default-test-suite.test.ts` | PENDING CP-5 |
| New unit coverage remains hermetic | `test/integration-pipelines.test.ts:1323`; `node --import tsx --test test/integration-pipelines.test.ts` | PASS |
| Focused, integration, general, and static-analysis verification pass | `npm run test:integration`; `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis` | PENDING CP-6 |

Next action: Add an integration-suite-specific runner failure test and tighten suite-routing coverage in `test/integration-pipelines.test.ts` and `test/default-test-suite.test.ts`.

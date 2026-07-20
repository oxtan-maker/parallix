# CP-6: Final verification and evidence

Completed the focused baseline, planner, failure-propagation, and routing checks; both restored E2E gates; the explicit integration suite; the general verifier; and static analysis. The E2E lifecycle and real-agent smoke tests passed after the normal implementation build, with the smoke test run through the required `codex` `gpt-5.6-luna` override. The integration plan now uses an explicit, named unconditional gate and the runner regression proves its nonzero result prevents a subsequent simulated squash command. Review round 1 also repaired the production `verify-local.sh integrate` path so it honors unconditional gates for classified and empty/no-area inputs; disposable-config verifier tests cover its resolved plans and failure short-circuit.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| TypeScript lifecycle harness matches the pre-task-2276 JavaScript behavior | pre-task-2276 commit `957c8860^`; `test/e2e-mission-lifecycle.test.ts:13`; `"feature-branch lifecycle drafts from the recorded base and integrates back into that feature branch"` | PASS |
| TypeScript real-agent harness matches the pre-task-2276 JavaScript behavior | pre-task-2276 commit `957c8860^`; `test/e2e-real-agent-smoke.test.ts:988`; `"real Codex gpt-5.6-luna launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` | PASS |
| Both restored E2E gates and the explicit integration suite run on the implementation tree | `npm run build`; `node --import tsx test/e2e-mission-lifecycle.test.ts`; `npm run test:integration` | PASS |
| Real-agent smoke uses only the supported Codex `gpt-5.6-luna` override | `test/e2e-real-agent-smoke.test.ts:37`; `PARALLIX_REAL_AGENT=codex PARALLIX_REAL_AGENT_MODEL=gpt-5.6-luna node --import tsx test/e2e-real-agent-smoke.test.ts` | PASS |
| Each resolved plan has a named gate with the exact integration-suite command | `config/integration-pipelines.json:15`; `lib/commands/integrate.ts:421`; `scripts/verify-local.sh:253`; `"verify-local integrate resolves the unconditional integration suite for every required area class (task-2292)"` | PASS |
| Plans for lib, workflow, docs, backlog, mission artifacts, unknown paths, and no-area inputs include the suite gate | `test/integration-pipelines.test.ts:1347`; `test/verify-local-integrate.test.ts:106`; `"verify-local integrate resolves the unconditional integration suite for every required area class (task-2292)"` | PASS |
| Lifecycle E2E and custom-agent smoke remain distinct, area-scoped, and ordered after the suite gate | `config/integration-pipelines.json:26`; `test/integration-pipelines.test.ts:1356`; `test/verify-local-integrate.test.ts:137`; `"verify-local integrate resolves the unconditional integration suite for every required area class (task-2292)"` | PASS |
| A nonzero integration-suite result blocks squash progression | `test/integration-pipelines.test.ts:289`; `test/verify-local-integrate.test.ts:150`; `"verify-local integrate aborts after an integration-suite failure before a later command (task-2292)"` | PASS |
| The explicit integration suite covers every listed non-E2E boundary test excluded from `npm test` | `test/run-default-tests.js:75`; `test/default-test-suite.test.ts:81`; `"default test runner routes every moved group to integration and excludes it from default"` | PASS |
| New planner and runner tests are hermetic | `test/integration-pipelines.test.ts:289`; `node --import tsx --test test/integration-pipelines.test.ts` | PASS |
| Focused, integration, general, and static-analysis verification pass | `node --import tsx --test test/integration-pipelines.test.ts`; `node --import tsx --test test/verify-local-integrate.test.ts`; `npm run test:integration`; `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis` | PASS |

Next action: Commit this final checkpoint document, then leave the mission ready for Parallix lifecycle handling without invoking `px review` or `px integrate`.

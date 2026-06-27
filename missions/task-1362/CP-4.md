# CP-4: Add unit tests for lib area detection and gate execution

## Work Done

Added 5 unit tests to `test/integration-pipelines.test.js` covering the task-1362 scope:

1. **`parseFilesToAreas detects lib as a known area`** — verifies `lib/commands/integrate.js` resolves to `['lib']`
2. **`getIntegrationGatePlan returns lib gate for lib-touching mission`** — verifies a mission changing `lib/` files gets a gate plan with `key='lib'` and `command='./scripts/verify-local.sh static-analysis'`
3. **`getIntegrationGatePlan excludes lib gate for docs-only mission`** — verifies a docs-only mission does NOT include the lib gate
4. **`executeIntegrationGates aborts when lib gate command fails`** — verifies `{ok:false, failedGate:'lib'}` on command failure
5. **`executeIntegrationGates succeeds when lib gate command passes`** — verifies `{ok:true, failedGate:null}` on command success

All 5 tests pass. Full test run: 25 pass, 0 fail, 8 skipped (monorepo-specific).

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | `parseFilesToAreas` detects 'lib' | `test/integration-pipelines.test.js:446` — test passes |
| 2 | Gate plan includes lib for lib-touching mission | `test/integration-pipelines.test.js:460` — `plan.gates[0].key === 'lib'` |
| 3 | Gate plan excludes lib for docs-only mission | `test/integration-pipelines.test.js:483` — `!plan.gates.some(g => g.key === 'lib')` |
| 4 | Gate aborts on failure | `test/integration-pipelines.test.js:506` — `result.ok === false, result.failedGate === 'lib'` |
| 5 | Gate succeeds on pass | `test/integration-pipelines.test.js:519` — `result.ok === true, result.failedGate === null` |

## Next action
Update `AGENTS.md` and `docs/adr/0041-integration-pipeline-gates.md` to reflect the new gate (CP-5).

# CP-4: Exercise the integration lifecycle boundary

## Summary

Ran the focused integration-pipeline test file, then exercised the repository integration dispatcher directly in dry-run mode with controlled changed areas. A `lib` change resolved the ordered `lib`, `build`, `workflow`, and `custom-agent-smoke` gates; a `docs`-only change resolved no applicable gates. The required static-analysis gate and configured `npm run build:cjs` command both exited successfully.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Focused integration-plan behavior passes | `node --test test/integration-pipelines.test.js`; test "getIntegrationGatePlan preserves run_last ordering with build gate inserted (task-1419)" | PASS |
| The integration dispatcher shares enabled/scoped matching logic | scripts/verify-local.sh:144; lib/commands/integrate.ts:413 | PASS |
| A controlled `lib` dry run includes the build gate in order | `INTEGRATE_DRY_RUN=true INTEGRATE_CHANGED_AREAS=lib ./scripts/verify-local.sh integrate`; config/integration-pipelines.json:3 | PASS |
| A controlled `docs` dry run excludes the build gate | `INTEGRATE_DRY_RUN=true INTEGRATE_CHANGED_AREAS=docs ./scripts/verify-local.sh integrate`; test "getIntegrationGatePlan with repo config excludes build for docs-only changes (task-1419)" | PASS |
| Explicitly disabled gates and legacy metadata remain covered | test "orderIntegrationGates skips gates with enabled:false (task-1419)"; test "orderIntegrationGates includes legacy gates without enabled metadata (task-1419)" | PASS |
| Static analysis succeeds for the changed `lib` surface | `./scripts/verify-local.sh static-analysis`; lib/commands/integrate.ts:317 | PASS |
| The configured build command succeeds on the checkpoint tree | `npm run build:cjs`; config/integration-pipelines.json:9 | PASS |

Next action: Run the full `./scripts/verify-local.sh all` gate, inspect the worktree for generated build output, and record final verification in CP-5.

# CP-1: Focused red/green tests for gate-metadata enabled/areas behavior

## Summary

Added 12 focused tests to `test/integration-pipelines.test.js` covering the new `enabled` and `areas` gate metadata for task-1419. Implemented the corresponding production changes in `lib/commands/integrate.ts` and `scripts/verify-local.sh` to make all tests green.

### Tests added (all passing)
- `orderIntegrationGates skips gates with enabled:false (task-1419)`
- `orderIntegrationGates includes legacy gates without enabled metadata (task-1419)`
- `orderIntegrationGates carries areas metadata through to gate objects (task-1419)`
- `gateMatchesChangedAreas uses areas metadata when provided (task-1419)`
- `gateMatchesChangedAreas falls back to key-based matching when areas not provided (task-1419)`
- `getIntegrationGatePlan selects build gate for lib changes when configured with areas (task-1419)`
- `getIntegrationGatePlan excludes build gate for docs-only changes (task-1419)`
- `getIntegrationGatePlan omits explicitly disabled build gate (task-1419)`
- `getIntegrationGatePlan selects build gate for workflow changes (task-1419)`
- `getIntegrationGatePlan preserves run_last ordering with build gate inserted (task-1419)`
- `script integrate: dry-run shows build gate when lib area present (task-1419)` (skipped — monorepo-only)
- `script integrate: dry-run omits build gate for docs-only changes (task-1419)` (skipped — monorepo-only)

### Production changes
- `orderIntegrationGates` now filters out gates with `enabled: false` and carries `areas` metadata through to returned gate objects (lib/commands/integrate.ts:317-343)
- `gateMatchesChangedAreas` accepts optional third parameter `gateAreas` for area-based matching, falling back to key-based matching when not provided (lib/commands/integrate.ts:345-358)
- `getIntegrationGatePlan` passes `gate.areas` to `gateMatchesChangedAreas` (lib/commands/integrate.ts:416)
- `scripts/verify-local.sh` updated to pass `gate.areas` to `gateMatchesChangedAreas` (scripts/verify-local.sh:145)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| enabled:false gates filtered by orderIntegrationGates | `orderIntegrationGates skips gates with enabled:false (task-1419)` test name; lib/commands/integrate.ts:332-338 | PASS |
| Legacy gates without enabled metadata treated as enabled | `orderIntegrationGates includes legacy gates without enabled metadata (task-1419)` test name; lib/commands/integrate.ts:332-338 | PASS |
| areas metadata carried through to gate objects | `orderIntegrationGates carries areas metadata through to gate objects (task-1419)` test name; lib/commands/integrate.ts:328 | PASS |
| gateMatchesChangedAreas uses areas when provided | `gateMatchesChangedAreas uses areas metadata when provided (task-1419)` test name; lib/commands/integrate.ts:347-349 | PASS |
| Key-based matching preserved for legacy gates | `gateMatchesChangedAreas falls back to key-based matching when areas not provided (task-1419)` test name; lib/commands/integrate.ts:350-358 | PASS |
| Build gate selected for lib changes via areas | `getIntegrationGatePlan selects build gate for lib changes when configured with areas (task-1419)` test name | PASS |
| Build gate excluded for docs-only changes | `getIntegrationGatePlan excludes build gate for docs-only changes (task-1419)` test name | PASS |
| Disabled build gate omitted from plan | `getIntegrationGatePlan omits explicitly disabled build gate (task-1419)` test name | PASS |
| run_last ordering preserved with build gate | `getIntegrationGatePlan preserves run_last ordering with build gate inserted (task-1419)` test name | PASS |
| verify-local.sh uses same areas-aware plan | `scripts/verify-local.sh:145` passes `gate.areas` to `gateMatchesChangedAreas` | PASS |

Next action: Add the `build` gate entry to `config/integration-pipelines.json` with order 2, areas [lib, workflow], and enabled true (CP-3).

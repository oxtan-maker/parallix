# CP-2: Implement gate-metadata parsing/filtering in lib/commands/integrate.ts

## Summary

Implemented the minimal gate-metadata changes in `lib/commands/integrate.ts` to support `enabled` and `areas` configuration on integration pipeline gates. Updated `scripts/verify-local.sh` to use the same areas-aware matching. All existing tests remain passing, confirming backward compatibility.

### Changes made
1. `orderIntegrationGates` (lib/commands/integrate.ts:317-343):
   - Filters out gates where `enabled` is explicitly `false`
   - Carries `areas` metadata from config into returned gate objects when present
   - Preserves all existing behavior for gates without `enabled` or `areas` metadata

2. `gateMatchesChangedAreas` (lib/commands/integrate.ts:345-358):
   - Accepts optional third parameter `gateAreas` for area-based matching
   - When `gateAreas` is provided, matches if any changed area is in `gateAreas`
   - Falls back to existing key-based matching (including web-e2e, workflow, custom-agent-smoke special cases) when `gateAreas` is not provided

3. `getIntegrationGatePlan` (lib/commands/integrate.ts:416):
   - Passes `gate.areas` to `gateMatchesChangedAreas` so area-based matching is used for gates that declare it

4. `scripts/verify-local.sh` (line 145):
   - Updated gate filtering to pass `gate.areas` to `gateMatchesChangedAreas`, matching the integrate.ts behavior

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Gates with enabled:false are filtered out | lib/commands/integrate.ts:332-338; test "orderIntegrationGates skips gates with enabled:false (task-1419)" | PASS |
| Legacy gates without enabled/areas work unchanged | lib/commands/integrate.ts:332-338; test "orderIntegrationGates includes legacy gates without enabled metadata (task-1419)" | PASS |
| areas metadata carried through to gate objects | lib/commands/integrate.ts:328; test "orderIntegrationGates carries areas metadata through to gate objects (task-1419)" | PASS |
| Area-based matching used when gateAreas provided | lib/commands/integrate.ts:347-349; test "gateMatchesChangedAreas uses areas metadata when provided (task-1419)" | PASS |
| Key-based matching preserved for legacy gates | lib/commands/integrate.ts:350-358; test "gateMatchesChangedAreas falls back to key-based matching when areas not provided (task-1419)" | PASS |
| verify-local.sh uses same areas-aware plan | scripts/verify-local.sh:145 passes `gate.areas` to `gateMatchesChangedAreas` | PASS |
| All existing tests still pass | `node --test test/integration-pipelines.test.js` — 43 pass, 0 fail | PASS |

Next action: Add the `build` gate entry to `config/integration-pipelines.json` with order 2, areas [lib, workflow], and enabled true (CP-3).

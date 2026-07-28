# CP-1: Pre-implementation mapping and TASK-2285 clearance

## Summary

Confirmed TASK-2285 is integrated on this branch (commit `dacb0dbde`). Mapped all four legacy modules, nine reverse-import sites, legacy consumers, two forwarding shims, dist-path test references, boundary-guard structure, and ADR 0051 invariants.

### TASK-2285 clearance
TASK-2285 is integrated into our branch (`dacb0dbde` is an ancestor of HEAD). Its changes to `scripts/build-canonical-bundle.js` are present and this task can proceed.

### Four legacy modules to relocate

| Module | Current path | Target path | LOC |
|---|---|---|---|
| contracts | `src/platform/runtime/lib/application/contracts.ts` | `src/application/contracts.ts` | ~35 |
| ports | `src/platform/runtime/lib/application/ports.ts` | `src/application/ports.ts` | ~30 |
| active-service | `src/platform/runtime/lib/application/active-service.ts` | `src/application/active-service.ts` | ~45 |
| stats-backfill-service | `src/platform/runtime/lib/application/stats-backfill-service.ts` | `src/application/stats-backfill-service.ts` | ~40 |

### Nine reverse-import sites (canonical/adapter layers importing legacy tree)

1. `src/application/projections/board-readers.ts:5` — `SourceFact` from `contracts.js`
2. `src/application/projections/board.ts:3` — `SourceFact` from `contracts.js`
3. `src/application/services/index.ts:1` — re-exports `ActiveService` (forwarding shim)
4. `src/application/services/index.ts:2` — re-exports `StatsBackfillService` (forwarding shim)
5. `src/application/controller/board-controller.ts:1-2` — `ActivePort`, `ProgressPort` from `ports.js`; `ActiveService`, `ActiveRequest`, `ActiveResult` from `active-service.js`
6. `src/application/controller/board-command.ts:1-2` — `Capability`, `DurableEvidence`, `ProgressEvent`, `failure`, `rejected`, `ApplicationOutcome` from `contracts.js`
7. `src/adapters/backlog/concrete-mission-read-adapter.ts:7` — `SourceFact` from `contracts.js`
8. `src/adapters/legacy/index.ts:1` — re-exports `LegacyActiveAdapter` (forwarding shim)
9. `src/adapters/legacy/index.ts:2` — re-exports `LegacyStatsBackfillAdapter` (forwarding shim)

### Legacy consumers (import via relative `../application/`)

- `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:9-10` — `DurableEvidence` from `contracts.js`, `ActiveLaunch`, `ActivePort` from `ports.js`
- `src/platform/runtime/lib/adapters/legacy-stats-backfill-adapter.ts:3-4` — `DurableEvidence` from `contracts.js`, `StatsBackfillPort`, `StatsProjection`, `StatsRow` from `ports.js`
- `src/platform/runtime/lib/composition/application-services.ts:1-2,5` — `ActiveService`, `StatsBackfillService`, `ProgressPort`
- `src/platform/runtime/lib/commands/stats-backfill.ts:13-14` — `createProductionApplicationServices`, `StatsBackfillService`

### Forwarding shims (no external consumers, removable)

- `src/application/services/index.ts` — two-line re-export of `ActiveService` + `StatsBackfillService` plus `PreparedAgentSelection`. No file in `src/` or `test/` imports from `application/services` path.
- `src/adapters/legacy/index.ts` — two-line re-export of `LegacyActiveAdapter` + `LegacyStatsBackfillAdapter`. Only consumed by `composition/application-services.ts` which imports the adapters directly (not through the shim).

### Dist-path tests requiring updates

- `test/application-contracts.test.ts:4` — `require('../dist/lib/application/contracts')`
- `test/application-services.test.ts:4` — `require('../dist/lib/application/stats-backfill-service')`
- `test/application-services.test.ts:5` — `require('../dist/lib/application/active-service')`
- `test/legacy-active-adapter.test.ts:4` — `require('../dist/lib/adapters/legacy-active-adapter')`

### Boundary guard structure

- `src/platform/runtime/lib/architecture/boundary-guards.ts` — `findForbiddenApplicationDependencies()` walks entry files; `forbidden` array includes bare `'sqlite'` token
- `test/application-boundaries.test.ts` — hardcoded 9-entry list; does not walk `src/application/` directory
- `test/domain-import-boundary.test.ts` — reference pattern: walks `src/domain/` directory with `fs.readdirSync`

### ADR 0051 invariants to preserve

- `docs/adr/0051-ui-neutral-application-boundary.md` — dependency direction diagram shows application use cases → ports → adapters
- Active lifecycle: launch → record → handoff ordering, rollback on failure
- Stats-backfill: projection before write, `--apply` distinction
- `px active` has no JSON contract

### Build-script implications

`scripts/build-canonical-bundle.js` emits `src/platform/runtime` as CJS and `src/platform/runtime/lib` as ESM. After relocation, `src/application/` (the new home of the four modules) must be added as an ESM emit tree so that the legacy adapters in `dist/lib/adapters/` can resolve their relative imports to the new module paths.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| TASK-2285 integrated or overlap removed | `git log --oneline HEAD` shows `dacb0dbde mission/task-2285: task-2285` as ancestor | PASS |
| Four legacy modules identified | `src/platform/runtime/lib/application/` contains `contracts.ts`, `ports.ts`, `active-service.ts`, `stats-backfill-service.ts` | PASS |
| Nine reverse-import sites mapped | `grep -rn "platform/runtime/lib/application" src/` returns 9 lines across 7 files | PASS |
| Two forwarding shims identified as removable | `src/application/services/index.ts`, `src/adapters/legacy/index.ts` have no external consumers | PASS |
| Dist-path tests identified | `test/application-contracts.test.ts:4`, `test/application-services.test.ts:4-5` use `dist/lib/application/` paths | PASS |
| Boundary guard structure mapped | `src/platform/runtime/lib/architecture/boundary-guards.ts:4` has `forbidden` array with bare `'sqlite'`; `test/application-boundaries.test.ts` has hardcoded 9-entry list | PASS |
| ADR 0051 invariants catalogued | `docs/adr/0051-ui-neutral-application-boundary.md` dependency diagram and contract rules | PASS |

Next action: CP-2 — Relocate the four modules to `src/application/`, update all production imports in canonical, adapter, and legacy layers, remove forwarding shims, update build-script emit trees, and update dist-path tests.

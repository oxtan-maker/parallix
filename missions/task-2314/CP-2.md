# CP-2: Relocate application modules, update imports, remove forwarding shims

## Summary

Relocated four application modules from `src/platform/runtime/lib/application/` to `src/application/`, updated all production and build-script imports, removed two forwarding shims, and updated dist-path tests.

### Module relocations

| Module | Old path | New path |
|---|---|---|
| contracts | `src/platform/runtime/lib/application/contracts.ts` | `src/application/contracts.ts` |
| ports | `src/platform/runtime/lib/application/ports.ts` | `src/application/ports.ts` |
| active-service | `src/platform/runtime/lib/application/active-service.ts` | `src/application/active-service.ts` |
| stats-backfill-service | `src/platform/runtime/lib/application/stats-backfill-service.ts` | `src/application/stats-backfill-service.ts` |

### Import updates

**Canonical layer** (src/application/ and src/adapters/):
- `src/application/projections/board-readers.ts` — `../../platform/runtime/lib/application/contracts.js` → `../contracts.js`
- `src/application/projections/board.ts` — same pattern
- `src/application/controller/board-controller.ts` — `ports.js` and `active-service.js` paths updated
- `src/application/controller/board-command.ts` — `contracts.js` path updated
- `src/adapters/backlog/concrete-mission-read-adapter.ts` — `../../platform/runtime/lib/application/contracts.js` → `../../application/contracts.js`

**Legacy consumers** (src/platform/runtime/lib/):
- `legacy-active-adapter.ts` — `../application/contracts.js` → `../../../../application/contracts.js` (and ports.js)
- `legacy-stats-backfill-adapter.ts` — same pattern
- `composition/application-services.ts` — `../application/active-service.js` → `../../../../application/active-service.js` (and stats-backfill-service.js, ports.js)
- `commands/stats-backfill.ts` — `../application/stats-backfill-service.js` → `../../../../application/stats-backfill-service.js`

### Forwarding shims removed

- `src/application/services/index.ts` — was a two-line re-export of `ActiveService` + `StatsBackfillService` + `PreparedAgentSelection`; no external consumers found
- `src/adapters/legacy/index.ts` — was a two-line re-export of `LegacyActiveAdapter` + `LegacyStatsBackfillAdapter`; only consumed by `composition/application-services.ts` which imports directly

### Domain ports rename

- `src/application/ports/domain.ts` → `src/application/domain-ports.ts` (to avoid directory/file conflict with relocated `ports.ts`)
- `src/application/services/agent-selection.ts` import updated accordingly

### Build script updates

- `scripts/build-canonical-bundle.js`:
  - Added CJS emit for `src/application/` → `dist/application/`
  - Added ESM emit for `src/application/` → `dist/application/`
  - Added four `.replace()` rules in CJS emit to fix cross-tree imports (`../../../../application/` → `../../application/`)
- `scripts/build-test-runtime.js`:
  - Added `src/application/` to the emit list (→ `.test-runtime/application/`)

### Test infrastructure updates

- `test/source-runtime-alias.js`:
  - Added `../dist/application/` to the dist→test-runtime mapping
  - Added cross-tree relative import remapping for both `.test-runtime/lib/` and `dist/lib/` parents (handles `../../../../application/` paths that escape the shallower tree)
- `test/application-contracts.test.ts`: `dist/lib/application/contracts` → `dist/application/contracts`
- `test/application-services.test.ts`: `dist/lib/application/stats-backfill-service` → `dist/application/stats-backfill-service` (and active-service)
- `test/application-boundaries.test.ts`: Updated entry paths for `active-service.ts` and `stats-backfill-service.ts`

### Verification

- `grep -rn "platform/runtime/lib/application" src/` returns no results (zero legacy imports from canonical/adapter layers)
- Full default test suite: **1354 tests pass, 0 failures**
- Bundle size: 2.7 MB (within 5 MB stop rule)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Four modules relocated to src/application/ | `src/application/contracts.ts`, `src/application/ports.ts`, `src/application/active-service.ts`, `src/application/stats-backfill-service.ts` exist; `src/platform/runtime/lib/application/` directory removed | PASS |
| No file under src/application or src/adapters imports legacy tree | `grep -rn "platform/runtime/lib/application" src/` returns 0 results | PASS |
| Legacy consumers import from canonical home | `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:9` imports `../../../../application/contracts.js`; `composition/application-services.ts:1` imports `../../../../application/active-service.js` | PASS |
| Forwarding shims removed | `src/application/services/index.ts` and `src/adapters/legacy/index.ts` deleted; no consumers depended on them | PASS |
| Build script emits both CJS and ESM for src/application/ | `scripts/build-canonical-bundle.js` has `emitCommonJsTree` and `emitEsmTree` for `src/application` | PASS |
| Dist-path tests updated | `test/application-contracts.test.ts:4` uses `dist/application/contracts`; `test/application-services.test.ts:4-5` use `dist/application/` paths | PASS |
| Default test suite green | `npm test` — 1354 pass, 0 fail | PASS |

Next action: CP-3 — Change the application boundary suite to directory discovery, add fixtures proving automatic coverage of a newly violating file, and add the `node:sqlite` reject versus SQLite-adapter accept distinction.

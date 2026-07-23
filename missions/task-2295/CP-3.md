# CP-3: Composition-root materialized blocklist wired into the real selector (no async cascade)

## Summary

The operator-local agent blocklist is now genuinely authoritative for a real production consumer without introducing an async cascade. The composition root opens SQLite, runs migrations, and materializes the blocklist into a plain in-memory overlay via a single async read. That overlay is handed to `LegacyActiveAdapter`, which — when SQLite is enabled — overlays it as the sole authority for the `config.blocklist` field consumed by the existing synchronous selector (`launcher-selection.ts::eligibleAgentsForStep` → `agent-config.ts::isAgentBlocked`). When SQLite is disabled/unavailable the overlay is `null` and the selector reads the untouched file-based `config.blocklist` exactly as before.

An earlier iteration of this mission wired a parallel `SqliteAgentSelectionSnapshotPort` → `PreparedAgentSelection` selector into `ActiveService`; that path never influenced the real health-probing selector (empty blocklist table in production, step-name mismatch, silent fallback) and was removed. The pure `PreparedAgentSelection`/`selectAgent` domain code from TASK-2294 is unchanged on `main`.

### Files
- `src/adapters/sqlite/blocklist-snapshot.ts` — pure, driver-free `materializeBlocklistSnapshot()` + `OperatorBlocklistOverlay` type (single source of truth for the overlay shape)
- `src/platform/runtime/lib/composition/application-services.ts` — async composition root; materializes the blocklist once and passes it to the adapter
- `src/platform/runtime/lib/adapters/legacy-active-adapter.ts` — `resolveAgentConfig()` overlays the SQLite blocklist onto the file config's `blocklist` field only (sync)
- `test/sqlite-async-cascade-cp3.test.ts` — 7 tests

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3: Single async boundary is the composition-root materialization | `src/platform/runtime/lib/composition/application-services.ts:54` (`materializeOperatorState`); test `"materializes the operator blocklist from SQLite via a single async read"` in `test/sqlite-async-cascade-cp3.test.ts` | PASS |
| SC3: The real selector consumes the blocklist synchronously (no Promise) | test `"the real selector consumes the SQLite blocklist synchronously and excludes blocked agents"` asserts `eligibleAgentsForStep` returns an array, not a Promise, and excludes the SQLite-blocked agent | PASS |
| SC3: Zero new async in the real consumer modules | tests `"agent-config.ts consumer functions are not async"` and `"launcher-selection.ts selection functions are not async"` in `test/sqlite-async-cascade-cp3.test.ts`; `src/platform/runtime/lib/agents/agent-config.ts` has 0 `async function` declarations | PASS |
| SC3: The materializer is a pure sync mapper | test `"the blocklist materializer is a pure synchronous mapper (no async, no I/O imports)"`; `src/adapters/sqlite/blocklist-snapshot.ts` imports no driver/`node:fs` | PASS |
| SC3: SQLite blocklist maps to the blocklist field, time-based blocks expire | test `"time-based SQLite blocks apply and expire through the existing sync isAgentBlocked logic"`; `src/adapters/sqlite/blocklist-snapshot.ts:33` | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` — ESLint, tsc, test-hygiene, test typecheck all PASS | PASS |

Next action: Implement transactional idempotent importers for stats.csv and agents.local.json (CP-4).

# CP-2: Port and SQLite persistence/query cut-over

## Summary

Every measurement producer and every default statistics reader now goes through
a `MeasurementStorePort` backed by SQLite. `stats.csv` is no longer read or
written on any default path.

**Port and adapter.** `src/application/measurement-ports.ts` declares
`MeasurementIdentity` (`:19`), `MeasurementRecord`, `MeasurementStorePort`
(`:72`), and `MeasurementStoreUnavailableError` (`:101`). The identity is
`(repo, mission, stage, actorKey)` — the grouping TASK-2322.02 left valid after
excluding `Attempt`. `actorKey` is computed by `statsRowToMeasurement`
(`src/platform/runtime/lib/commands/stats.ts:183`), the module that owns the
attribution rule, so no adapter infers an identity.
`src/adapters/sqlite/measurement-store.ts:74` implements the port over the
existing `usage_statistics` table, and migration
`src/adapters/sqlite/migrations/0007-usage-statistics-identity.sql` adds the
`actor_key` column plus a UNIQUE index on that identity — collapsing the
duplicate rows the file authority permitted.

The port is synchronous because every producer call site is synchronous. Rather
than import `node:sqlite` a second time (which
`"node:sqlite import is confined to src/adapters/sqlite/"` forbids),
`SqliteDatabaseAdapter` gained `openSync`/`executeSync`/`querySync`/`closeSync`
(`src/adapters/sqlite/database-adapter.ts:111`), so the driver import stays in
one module.

**Producers repointed.** `upsertMeasurementRow`
(`src/platform/runtime/lib/commands/stats.ts:1837`) keeps the previous
canonicalization and validation and swaps its sink from
`loadStatsCsv`/`saveStatsCsv` to a single transactional `upsertMeasurement`.
The six producers that route through it are unchanged in behavior:
`recordIntegrationStats` (`:1860`), `recordStageStats` (`:1995`),
`accumulateStageStats` (`:2024`), `recordActiveStats` (`:2101`),
`recordReviewStats` (`:2116`), and the backfill applier
(`src/platform/runtime/lib/adapters/legacy-stats-backfill-adapter.ts:35`).
`px integrate` no longer resolves a CSV path before recording the completed
mission (`src/platform/runtime/lib/commands/integrate.ts:1710`).

**Readers repointed.** `loadMeasurementRows`
(`src/platform/runtime/lib/commands/stats.ts:223`) returns the same
`{ headers, rows }` shape the CSV loader returned, mapping stored measurements
back to string-valued rows via `measurementToStatsRow` (`:150`) with the
historical `''`/`'0'` defaults. `renderWeeklyStatsReport`,
`renderRangeStatsReport`, and `renderMissionPhaseReport` therefore receive
identical input and were not modified — filtering, totals, grouping,
formatting, and missing-data behavior are preserved by construction, which the
unchanged renderer tests in `test/stats.test.ts` confirm. The `px stats`
command (`:2391`) reads the database when no file is named and reports a
database failure instead of falling back. `px stats-backfill` reads already
recorded missions from the store
(`src/platform/runtime/lib/commands/stats-backfill.ts:195`).

**Legacy helpers removed.** `saveStatsCsv`, `loadStatsCsv`, `upsertStatsRow`,
`resolveStatsPath`, `resolveStatsFilePath`, `resolveStatsCsvPath`,
`resolveRepoStatsCsvPath`, `storage.resolveStatsPath`, `migrateStats` (and its
CSV reader/writer helpers), and the `adapters.stats.path` config knob are gone
from production code and from the config schema.

**Concurrency fix found by test.** Migration application originally used a
deferred `BEGIN`, which fails outright with "database is locked" when another
connection holds the write lock instead of waiting out `busy_timeout`. It now
uses `BEGIN IMMEDIATE`
(`src/adapters/sqlite/measurement-store.ts:311`), matching `upsertAll` (`:110`).

`./scripts/verify-local.sh all`: **1542 pass, 0 fail, exit 0** (baseline before
this checkpoint was 1495 pass / 0 fail).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — producers persist checked measurements through an application port | `src/application/measurement-ports.ts:72`; producers at `src/platform/runtime/lib/commands/stats.ts:1837`, `:1860`, `:1995`, `:2024`, `:2101`, `:2116`; `"upsertMeasurementRow persists the workflow stats schema and updates existing missions idempotently"` | PASS |
| SC1/SC6 — no adapter infers an `Attempt` or per-run identity | `src/platform/runtime/lib/commands/stats.ts:183` computes `actorKey` in the owning module; `"measurement store keys rows by (repo, mission, stage, actorKey) and never invents a per-run identity"`; `test/domain-attempt-guard.test.ts` passes | PASS |
| SC2 — the default statistics command reads SQLite, not a file | `src/platform/runtime/lib/commands/stats.ts:223`, `:2391`; `"stats command defaults to the shared PARALLIX_HOME database across target repos"` | PASS |
| SC2 — characterized filtering/totals/grouping/formatting/missing-data preserved | Renderers unmodified at `src/platform/runtime/lib/commands/stats.ts:1206`, `:1267`, `:1320`; `"renderWeeklyStatsReport calculates current and previous seven-day windows from injected today"`, `"task-1380: renderWeeklyStatsReport excludes in-progress missions"`, `"recordIntegrationStats returns the unchanged weekly report labels for integration output"` | PASS |
| SC2 — no board or TUI metric reader was left on the file authority | CP-1 inventory found none under `src/interfaces/tui`; the only metric surface is the three renderers above | PASS |
| SC4 — no default path resolves or reads `stats.csv` | `"no stats CSV path resolver survives the measurement cut-over"`; `"recording a measurement with no explicit path writes no CSV under PARALLIX_HOME (task-1246)"` | PASS |
| SC4 — SQLite unavailability fails rather than falling back | `src/application/measurement-ports.ts:101`; `"database failure raises MeasurementStoreUnavailableError and accesses no CSV"` | PASS |
| SC5 — save / upsert / stats-path helpers removed from production | `src/platform/runtime/lib/commands/stats.ts:373` (saveStatsCsv removed); `src/platform/runtime/lib/core/storage.ts:94` (resolveStatsPath removed); `src/platform/runtime/lib/core/persistent-data-migration.ts:5` (migrateStats removed); `"no stats CSV migration survives the measurement cut-over"` | PASS |
| SC6 — restart, concurrency, atomicity, and database-failure coverage exists | `test/measurement-store-cutover.test.ts`; `"a measurement remains available after the store is closed and reopened (restart)"`, `"concurrent measurement updates from two open connections retain every required record"`, `"upsertAll commits the whole batch or nothing, never a partial import"` | PASS |
| SC7 — ADR 0053 inventory updated to the new authority | `src/platform/runtime/lib/core/durable-state-inventory.ts:312` (`outcome-measurement-store-write`), `:326` (`measurement-store-read`) | PASS |
| SC7 — suite green after the cut-over | `./scripts/verify-local.sh all` — 1542 pass / 0 fail / exit 0 | PASS |

Next action: add the fast isolated tests for `px stats import-legacy` — dry-run,
atomic idempotent apply, byte-for-byte unchanged source CSV, and
malformed/ambiguous row reporting with no partial write (CP-3).

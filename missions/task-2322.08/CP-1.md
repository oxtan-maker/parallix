# CP-1: Dependency confirmation, producer/reader inventory, and port mapping

## Summary

No code changed in this checkpoint. It confirms the TASK-2322.02 and
TASK-2322.07 contracts, enumerates every runtime measurement producer,
statistics reader, CSV writer, CSV reader, and path-resolution helper, and
records the intended application-port / SQLite mapping before behavior changes.

### Dependency contracts confirmed

- **TASK-2322.02 (identity).** `Attempt` is excluded and the exclusion is
  test-enforced, not asserted: `test/domain-attempt-guard.test.ts` fails if any
  Attempt-shaped type, table, or record is declared under `src/domain`,
  `src/application`, or `src/adapters`. ADR 0053 records the same outcome
  (`docs/adr/0053-operational-persistence-and-authority-boundaries.md:98`) and
  states that measurements are grouped by `(repo, mission)` — the existing
  stats grouping key at `src/platform/runtime/lib/commands/stats.ts:441`. The
  usable identity for a stored measurement is therefore
  `(repo, mission, stage, actor)`, matching the current CSV upsert key at
  `src/platform/runtime/lib/commands/stats.ts:1846-1851` and the existing
  SQLite index `idx_usage_statistics_mission (repo, mission, stage)`
  (`src/adapters/sqlite/migrations/0001-initial-schema.sql:49-50`). No new
  per-run entity is required, so the mission's stop rule on identity does not
  fire.
- **TASK-2322.07 (Mission authority).** Integrated on `main`:
  `CompatibilityMissionStore` is gone and `SqliteMissionStore` is the sole
  Mission authority via the composition root
  (`src/platform/runtime/lib/composition/application-services.ts:218`). The
  ADR 0053 inventory carries zero `cutoverTask: 'TASK-2322.07'` entries. The
  SQLite substrate this mission builds on — `SqliteDatabaseAdapter`
  (`src/adapters/sqlite/database-adapter.ts:58`), the migration ledger
  (`src/adapters/sqlite/migration-runner.ts:62`), and the path resolver
  (`src/adapters/sqlite/database-path-resolver.ts:12`) — is live.

### Inventory

> **Baseline for the line numbers below:** this checkpoint inventoried the
> tree **before** any cut-over edit, at commit `cb6860dbc` (the CP-1 commit).
> CP-2 through CP-4 then moved, renamed, or deleted most of these symbols, so
> the `file:line` references in this section resolve against
> `git show cb6860dbc:<path>`, not against HEAD. CP-2, CP-4, and CP-5 carry the
> post-change references. Verify with, e.g.,
> `git show cb6860dbc:src/platform/runtime/lib/commands/stats.ts | sed -n '1833p'`.

**Measurement producers (all currently write CSV, all synchronous):**

| Producer | Location | Called from |
|---|---|---|
| `recordStageStats` | `src/platform/runtime/lib/commands/stats.ts:2017` | `src/platform/runtime/lib/commands/draft.ts:1104` (draft stage) |
| `accumulateStageStats` | `src/platform/runtime/lib/commands/stats.ts:2046` | stats.ts internal merge path |
| `recordActiveStats` | `src/platform/runtime/lib/commands/stats.ts:2123` | `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:99` |
| `recordReviewStats` | `src/platform/runtime/lib/commands/stats.ts:2138` | review stage recorders |
| `recordStageStatsSafe` | `src/platform/runtime/lib/review/review-loop.ts:99` | `src/platform/runtime/lib/review/review-loop.ts:1238` (review), `:1497` (active) |
| `recordIntegrationStats` | `src/platform/runtime/lib/commands/stats.ts:1882` | `src/platform/runtime/lib/commands/integrate.ts:1712` |
| `upsertStatsRow` (shared sink) | `src/platform/runtime/lib/commands/stats.ts:1833` | every producer above, plus `src/platform/runtime/lib/adapters/legacy-stats-backfill-adapter.ts:24` |

**Statistics readers:**

| Reader | Location |
|---|---|
| `px stats` default weekly/range report | `src/platform/runtime/lib/commands/stats.ts:2192` |
| `px stats <slug>` mission-phase report | `src/platform/runtime/lib/commands/stats.ts:2279` |
| Post-integration weekly + phase report | `src/platform/runtime/lib/commands/integrate.ts:1712-1725` |
| Historical backfill projection read | `src/platform/runtime/lib/commands/stats-backfill.ts:193` |
| Backfill apply read | `src/platform/runtime/lib/commands/stats-backfill.ts:380` |

No board or TUI module reads statistics: `grep -rln "stats" src/interfaces/tui src/interfaces/cli` returns no metric reader, and the only non-`stats.ts` consumers of `commands/stats.js` in `src/` are `index.ts`, `lib/index.ts`, `legacy-active-adapter.ts`, `review/review-loop.ts`, `legacy-stats-backfill-adapter.ts`, and `core/persistent-data-migration.ts`. The shared metric surface is therefore the three renderers `renderWeeklyStatsReport`
(`src/platform/runtime/lib/commands/stats.ts:1210`), `renderRangeStatsReport`
(`:1271`), and `renderMissionPhaseReport` (`:1324`), which must keep byte-identical output against the new authority.

**CSV writers / readers / path resolvers to retire from default runtime:**

| Helper | Location |
|---|---|
| `saveStatsCsv` | `src/platform/runtime/lib/commands/stats.ts:367` |
| `loadStatsCsv` | `src/platform/runtime/lib/commands/stats.ts:291` |
| `loadCsv` | `src/platform/runtime/lib/commands/stats.ts:266` |
| `resolveStatsPath` | `src/platform/runtime/lib/commands/stats.ts:148` |
| `resolveStatsFilePath` | `src/platform/runtime/lib/commands/stats.ts:178` |
| `resolveStatsCsvPath` | `src/platform/runtime/lib/commands/stats.ts:244` |
| `resolveRepoStatsCsvPath` | `src/platform/runtime/lib/commands/stats.ts:138` |
| `storage.resolveStatsPath` | `src/platform/runtime/lib/core/storage.ts:106` |
| `migrateStats` destination default | `src/platform/runtime/lib/core/persistent-data-migration.ts:148` |
| `adapters.stats.path` config default | `src/platform/runtime/lib/core/product-config.ts:20` |

**ADR 0053 inventory entries this mission must clear:**
`outcome-stats-csv` (`src/platform/runtime/lib/core/durable-state-inventory.ts:309`),
`measurement-stats-csv-read` (`:321`), `measurement-stats-csv-write` (`:330`),
`measurement-stats-backfill-read` (`:357`), and `artifacts-stats-output` (`:711`).

### Intended port and SQLite mapping

- **Port.** A synchronous `MeasurementStorePort` in `src/application/` exposing
  `listRecords()`, `findRecord(identity)`, and `upsertRecord(record)` over the
  22 checked measurement fields. Synchronous by design: every producer call
  site above is synchronous, and the SQLite substrate is `node:sqlite`
  `DatabaseSync` (`src/adapters/sqlite/database-adapter.ts:1`), which is
  natively synchronous — the existing `Promise` surface is a worker-thread
  affordance, not an async driver. No producer becomes async, so no
  characterized ordering changes.
- **SQLite adapter.** A `usage_statistics`-backed implementation reusing the
  existing table and index
  (`src/adapters/sqlite/migrations/0001-initial-schema.sql:23`,`:49`) and the
  existing `UsageRecord` field contract (`src/adapters/sqlite/ports.ts:83`).
  The record identity is `(repo, mission, stage, actor)` per TASK-2322.02; no
  `Attempt` or per-run row is introduced, so
  `test/domain-attempt-guard.test.ts` keeps passing.
- **Reader mapping.** `loadStatsCsv(...)` call sites become
  `store.listRecords()` mapped back to the same `StatsRow` string shape via the
  existing `normalizeStatsRow` (`src/platform/runtime/lib/commands/stats.ts:335`),
  so `renderWeeklyStatsReport`, `renderRangeStatsReport`, and
  `renderMissionPhaseReport` receive identical input and their characterized
  filtering, totals, grouping, formatting, and missing-data behavior is
  unchanged by construction.
- **Writer mapping.** `upsertStatsRow` keeps its canonicalization and validation
  (`:1801`, `:1837-1844`) and swaps `loadStatsCsv`/`saveStatsCsv` for a single
  transactional `upsertRecord`.
- **Legacy CSV boundary.** `loadCsv`/`parseCsvLine` survive only behind an
  explicit `px stats import-legacy --csv-file <path> [--apply]` boundary,
  reusing the existing `StatsBackfillPort` contract
  (`src/application/ports.ts:18`) and `StatsBackfillService`
  (`src/application/stats-backfill-service.ts:14`). `saveStatsCsv` and all
  four path resolvers are removed from production paths.

### Baseline

`./scripts/verify-local.sh all` on the unmodified tree: **1495 pass, 0 fail, 0
skipped, exit 0**. The pre-change baseline is green, so any later failure is a
regression from this mission rather than inherited red.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — every measurement producer enumerated with its checked-identity target | Producers at `src/platform/runtime/lib/commands/stats.ts:2017`, `:2046`, `:2123`, `:2138`, `:1882` and call sites `src/platform/runtime/lib/commands/draft.ts:1104`, `src/platform/runtime/lib/review/review-loop.ts:1238`, `:1497`, `src/platform/runtime/lib/commands/integrate.ts:1712`, `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:99` | Inventoried |
| SC1/SC6 — no `Attempt` or per-run identity will be inferred | `test/domain-attempt-guard.test.ts`; `docs/adr/0053-operational-persistence-and-authority-boundaries.md:98`; grouping key `src/platform/runtime/lib/commands/stats.ts:441` | Confirmed |
| SC2 — every default statistics/board/TUI metric reader enumerated | `src/platform/runtime/lib/commands/stats.ts:2192`, `:2279`, renderers `:1210`, `:1271`, `:1324`; `src/platform/runtime/lib/commands/integrate.ts:1712`; `src/platform/runtime/lib/commands/stats-backfill.ts:193`, `:380`; no reader under `src/interfaces/tui` | Inventoried |
| SC3 — legacy CSV import boundary target identified | `src/application/ports.ts:18` (`StatsBackfillPort`); `src/application/stats-backfill-service.ts:14`; `src/platform/runtime/lib/adapters/legacy-stats-backfill-adapter.ts:21` | Planned |
| SC4/SC5 — every CSV writer, reader, and path resolver to retire is listed | `src/platform/runtime/lib/commands/stats.ts:367`, `:291`, `:266`, `:148`, `:178`, `:244`, `:138`; `src/platform/runtime/lib/core/storage.ts:106`; `src/platform/runtime/lib/core/persistent-data-migration.ts:148`; `src/platform/runtime/lib/core/product-config.ts:20` | Inventoried |
| SC6 — SQLite substrate available for isolated restart/concurrency/failure fixtures | `src/adapters/sqlite/database-adapter.ts:58`; `src/adapters/sqlite/database-path-resolver.ts:12`; `src/adapters/sqlite/migrations/0001-initial-schema.sql:23` | Confirmed |
| SC7 — ADR 0053 inventory entries this mission must clear are identified | `src/platform/runtime/lib/core/durable-state-inventory.ts:309`, `:321`, `:330`, `:357`, `:711` | Inventoried |
| SC7 — required gates | `./scripts/verify-local.sh all` on the unmodified tree: 1495 pass / 0 fail / 0 skipped, exit 0 (green baseline); `./scripts/verify-local.sh static-analysis` deferred to CP-5 | Baseline green |

Next action: implement `MeasurementStorePort` in `src/application/` and its
`usage_statistics`-backed SQLite adapter, then repoint `upsertStatsRow`
(`src/platform/runtime/lib/commands/stats.ts:1833`) and the `loadStatsCsv`
read sites at the port (CP-2).

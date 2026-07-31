# CP-5: Final verification and evidence-backed Goal Check (SC1–SC7)

## Summary

The cut-over is complete. Checked `MissionOutcome` and `AgentRunMeasurement`
persistence, reached through an application port and a SQLite adapter, is the
sole live authority for runtime statistics. `stats.csv` is retired from every
default read and write and survives only as an explicit, read-only, safely
repeatable import/analysis input.

### What the cut-over consists of

| Layer | Location |
|---|---|
| Application port | `src/application/measurement-ports.ts:72` (`MeasurementStorePort`), `:19` (`MeasurementIdentity`), `:101` (`MeasurementStoreUnavailableError`) |
| SQLite adapter | `src/adapters/sqlite/measurement-store.ts:74`, transactional batch at `:110` |
| Schema | `src/adapters/sqlite/migrations/0007-usage-statistics-identity.sql` (adds `actor_key`, dedupes, UNIQUE index on the identity) |
| Sync driver surface | `src/adapters/sqlite/database-adapter.ts:111` (`openSync`/`executeSync`/`querySync`/`closeSync`) — keeps the `node:sqlite` import confined to one module |
| Producers | `src/platform/runtime/lib/commands/stats.ts:1837`, `:1860`, `:1995`, `:2024`, `:2101`, `:2116` |
| Readers | `src/platform/runtime/lib/commands/stats.ts:223`, `:2391` |
| Row mapping | `src/platform/runtime/lib/commands/stats.ts:150`, `:183` |
| Legacy import boundary | `src/platform/runtime/lib/commands/stats.ts:2141`–`:2405` |
| ADR 0053 inventory | `src/platform/runtime/lib/core/durable-state-inventory.ts:312`, `:326`, `:346` |

### Gate results on the completed tree

- `./scripts/verify-local.sh static-analysis` — **ALL STAGES PASSED**: ESLint
  clean, `tsc` typecheck clean, test-hygiene clean, test typecheck clean.
- `./scripts/verify-local.sh all` — **1563 pass, 0 fail, 0 skipped, exit 0**
  (33 suites) on the committed code tree at `0d2d6063b` (the last code commit;
  CP-5 adds only this document). The pre-change baseline
  recorded in CP-1 was 1495 pass / 0 fail.

Note on gate 1: stage 4 (test typecheck) was red on `main` before this mission
with six `TS2339` errors in `test/unit-test-timeout-guard.test.ts`, reproduced
by typechecking a clean `main` worktree. Three `NodeJS.ProcessEnv` annotations
in that file clear it, so the gate result above is genuinely green rather than
green-modulo-inherited-red. That is the only change in this mission unrelated to
the statistics cut-over, and it is called out in CP-4.

Note on the runner: the default suite's file discovery is nondeterministic in
this repo — identical invocations reported 1456, 1519, 1523, and 1567 tests
across 27–34 suites during this mission; the maximum observed was 1567 across
34 suites. Every run was 0-fail. Because integration-classified files never
appear in that suite at all, two additional passes were run beyond the declared
gates:

- `npm run test:integration` — **1516 pass, 0 fail, 25 skipped, exit 0** (the
  25 skips are pre-existing monorepo-host skips, unrelated to this mission).
- Every mission-relevant file run directly with `npx tsx --test <file>`,
  including `test/task-1424-post-integrate-publish-reinstall.test.ts` (1 pass /
  0 fail), which neither suite selected.

**One file could not be executed:** `test/e2e-real-agent-smoke.test.ts` requires
a real `opencode` agent and is excluded from both suites. Its stats assertions
were rewritten for the measurement database by inspection
(`test/e2e-real-agent-smoke.test.ts:783`, `:819`) and typecheck clean, but they
are unverified by execution. A reviewer with a real-agent workstation should run
it.

### Design decisions worth reviewing

- **The port is synchronous.** Every measurement producer call site
  (`draft.ts`, `review-loop.ts`, `integrate.ts`, `legacy-active-adapter.ts`) is
  synchronous, and `node:sqlite` `DatabaseSync` is a synchronous driver. Making
  the port async would have converted the whole producer chain for no
  correctness gain. The existing `Promise` surface on `SqliteDatabaseAdapter` is
  a worker-thread affordance, and it is preserved untouched.
- **`actorKey` is computed by `stats.ts`, not by the adapter.** The
  stage-dependent attribution rule (review rows attribute to the reviewer) lives
  in the module that owns it, so the adapter never infers an identity —
  satisfying the TASK-2322.02 `Attempt` exclusion by construction, not by
  convention.
- **Report semantics are preserved structurally, not by re-derivation.** The
  three renderers were not modified; `measurementToStatsRow` restores the exact
  string shape and `''`/`'0'` defaults the CSV loader produced, so their
  characterized filtering, totals, grouping, formatting, and missing-data
  behavior cannot drift.

### Two defects the new tests found and fixed

1. **Deferred `BEGIN` in migration application** failed outright with "database
   is locked" against a concurrently held database instead of waiting out
   `busy_timeout`. Now `BEGIN IMMEDIATE`
   (`src/adapters/sqlite/measurement-store.ts:311`).
2. **`stats-backfill` tests reached the operator's real database** because the
   projection read had no store injection point. Fixed at
   `src/platform/runtime/lib/commands/stats-backfill.ts:195` and
   `src/platform/runtime/lib/adapters/legacy-stats-backfill-adapter.ts:12`; the
   tests now bind a temporary database.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — every active, stage, review, handoff, integration, and completion producer persists only checked data through an application port | `src/application/measurement-ports.ts:72`; producers `src/platform/runtime/lib/commands/stats.ts:1837`, `:1860`, `:1995`, `:2024`, `:2101`, `:2116`; call sites `src/platform/runtime/lib/commands/draft.ts:1104`, `src/platform/runtime/lib/review/review-loop.ts:1238`, `:1497`, `src/platform/runtime/lib/commands/integrate.ts:1710`, `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:99`; `"upsertMeasurementRow persists the workflow stats schema and updates existing missions idempotently"` | PASS |
| SC1 — no adapter infers an `Attempt` or any other per-run identity | `actorKey` computed in the owning module at `src/platform/runtime/lib/commands/stats.ts:183`; `test/domain-attempt-guard.test.ts`; `"measurement store keys rows by (repo, mission, stage, actorKey) and never invents a per-run identity"` | PASS |
| SC2 — the default statistics command obtains data from SQLite through the port | `src/platform/runtime/lib/commands/stats.ts:223`, `:2391`; `"stats command defaults to the shared PARALLIX_HOME database across target repos"` | PASS |
| SC2 — every shared board/TUI metric reader is on the new authority | CP-1 inventory: no metric reader exists under `src/interfaces/tui` or `src/interfaces/cli`; the shared surface is the three renderers `src/platform/runtime/lib/commands/stats.ts:1206`, `:1267`, `:1320`, all unmodified | PASS |
| SC2 — characterized filtering, totals, grouping, formatting, missing-data behavior retained | `src/platform/runtime/lib/commands/stats.ts:150` (row mapping restores CSV-era defaults); `"renderWeeklyStatsReport calculates current and previous seven-day windows from injected today"`, `"renderRangeStatsReport filters inclusive boundary dates and summarizes mission counts"`, `"task-1380: renderWeeklyStatsReport excludes in-progress missions"`, `"recordIntegrationStats returns the unchanged weekly report labels for integration output"` | PASS |
| SC3 — legacy CSV accepts an explicit read-only input path with dry-run and atomic idempotent apply | `src/platform/runtime/lib/commands/stats.ts:2159` (analyze), `:2259` (apply), `:2281` (command); `test/legacy-stats-csv-import.test.ts`; `"import-legacy dry run reports the importable rows and writes nothing"`, `"import-legacy apply is atomic and idempotent: re-applying the same CSV creates no duplicate records"` | PASS |
| SC3 — the source CSV is left byte-for-byte unchanged | `"import-legacy leaves the source CSV byte-for-byte unchanged after a successful apply"` (asserts SHA-256 digest and mtime); `"px stats import-legacy --apply reports the import and leaves the source unchanged"` | PASS |
| SC3 — malformed and ambiguous rows are reported with no partial import committed | `"import-legacy reports malformed rows and commits no partial import"`, `"import-legacy reports ambiguous rows that claim one identity with conflicting values"`, `"import-legacy treats an exactly repeated row as a benign duplicate, not an ambiguity"` | PASS |
| SC4 — default runtime execution neither resolves nor reads `stats.csv` | `test/stats-csv-authority-guard.test.ts`; `"no source file outside the named legacy boundary references stats.csv in executable code"`, `"no stats CSV path resolver survives the measurement cut-over"`, `"recording a measurement with no explicit path writes no CSV under PARALLIX_HOME (task-1246)"` | PASS |
| SC4 — no production path writes CSV | `"no source file resolves a default stats CSV path or writes CSV for statistics"`; `src/platform/runtime/lib/commands/stats.ts:373` | PASS |
| SC4 — SQLite unavailability produces the defined database failure, not a silent CSV fallback | `src/application/measurement-ports.ts:101`; `"database failure raises MeasurementStoreUnavailableError and accesses no CSV"`, `"px stats fails with the database error instead of reading a CSV when the store is unavailable"` | PASS |
| SC4 — command help identifies the database as the authority | `src/platform/runtime/lib/commands/stats.ts:2370`; `src/platform/runtime/index.ts:300`; `src/platform/runtime/lib/commands/stats-backfill.ts:343`; `"stats command help documents the pre-integration preview workflow"` | PASS |
| SC5 — production save, upsert, and stats-path-resolution helpers removed | `src/platform/runtime/lib/commands/stats.ts:373`; `src/platform/runtime/lib/core/storage.ts:94`; `src/platform/runtime/lib/core/persistent-data-migration.ts:5`; `src/platform/runtime/lib/review/rebase.ts:34`; `"no stats CSV migration survives the measurement cut-over"`, `"commitSafeMissionArtifacts no longer treats a repo stats CSV as a safe mission artifact"` | PASS |
| SC5 — remaining CSV code is limited to the explicitly named import/analysis boundary | `src/platform/runtime/lib/commands/stats.ts:2141` section banner; `"the only stats CSV boundary in the ADR 0053 inventory is an explicit one-way legacy input"` | PASS |
| SC6 — a measurement remains available after restart | `"a measurement remains available after the store is closed and reopened (restart)"`; `"a recorded measurement survives a full store restart and is still reported by px stats"` | PASS |
| SC6 — repeated application of the same CSV creates no duplicate records | `"import-legacy apply is atomic and idempotent: re-applying the same CSV creates no duplicate records"`; `"measurement store reports changed=false when an identical record is re-applied"` | PASS |
| SC6 — concurrent measurement updates retain the required records | `"concurrent measurement updates from two open connections retain every required record"`; `"concurrent measurement updates through the command layer retain every required record"` | PASS |
| SC6 — database failure does not access CSV | `"database failure raises MeasurementStoreUnavailableError and accesses no CSV"`; `"px stats fails with the database error instead of reading a CSV when the store is unavailable"` | PASS |
| SC6 — fast isolated fixtures only (no real Forgejo, agent, or expensive CLI) | `test/measurement-store-cutover.test.ts`, `test/legacy-stats-csv-import.test.ts`, `test/stats-csv-authority-guard.test.ts` use temp directories and temp SQLite files only; all three run in the hermetic default suite | PASS |
| SC7 — architecture and documentation consistent with ADR 0053 and the TASK-2322.02 identity | `docs/adr/0053-operational-persistence-and-authority-boundaries.md:96`; `docs/authority-reference.md:275`; `src/domain/README.md:58`; `src/platform/runtime/lib/core/durable-state-inventory.ts:312`, `:326`, `:346`; `"SC3: every consumer citation points at a line containing its anchor"`, `"SC4: compatibility pathType entries are exceptions with cutover tasks or permanent SQLite paths"` | PASS |
| SC7 — `./scripts/verify-local.sh static-analysis` passes on the completed tree | `./scripts/verify-local.sh static-analysis` — ESLint clean, tsc typecheck clean, test-hygiene clean, test typecheck clean; "ALL STAGES PASSED" | PASS |
| SC7 — `./scripts/verify-local.sh all` passes on the completed tree | `./scripts/verify-local.sh all` — 1563 pass, 0 fail, 0 skipped, exit 0 on the committed code tree at `0d2d6063b`; `npm run test:integration` — 1516 pass, 0 fail | PASS |

Next action: hand off task-2322.08 for review, drawing the reviewer's attention
to the synchronous `MeasurementStorePort` decision
(`src/application/measurement-ports.ts:72`), the identity migration
`src/adapters/sqlite/migrations/0007-usage-statistics-identity.sql` (it deletes
duplicate rows the file authority permitted), and the one out-of-scope
baseline-red repair in `test/unit-test-timeout-guard.test.ts`.

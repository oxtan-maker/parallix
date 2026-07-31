# CP-3: Explicit legacy CSV import/analysis boundary

## Summary

`px stats import-legacy --csv-file <path> [--apply] [--json]` is the only way a
`stats.csv`-shaped file can enter the runtime after the cut-over. It is
implemented in `src/platform/runtime/lib/commands/stats.ts` behind the section
banner at `:2141`, dispatched at `:2405`, and reachable only when the operator
names a file — there is no default resolution.

**Analysis (`analyzeLegacyStatsCsv`, `src/platform/runtime/lib/commands/stats.ts:2159`).**
Opens the named file read-only, refuses an empty path, refuses a file that is
not a stats dataset, and classifies every row:

- *malformed* — missing mission, missing or unparseable date (non `YYYY-MM-DD`),
  unknown classification, missing implementer, or a non-numeric measurement
  column. Each is reported with its real CSV line number and the specific
  reasons.
- *ambiguous* — two rows of the same file claiming one
  `(repo, mission, stage, actor)` identity with different values, reported with
  the conflicting line numbers. An exactly repeated row is a benign duplicate,
  not an ambiguity.

**Apply (`applyLegacyStatsCsv`, `:2259`).** Refuses the whole batch when any row
is malformed or ambiguous, so no partial import is committed. A clean batch goes
through one `store.upsertAll(...)` call — a single `BEGIN IMMEDIATE`
transaction (`src/adapters/sqlite/measurement-store.ts:110`) — so it is atomic.
Because rows are keyed by identity, re-applying the same file updates in place
and creates no duplicate records.

**Read-only source.** Nothing in the boundary writes, renames, or rewrites the
named file; `readLegacyStatsCsv` (`:302`) and `analyzeLegacyStatsCsv` only call
`fs.readFileSync`. The tests assert this on content digest *and* mtime.

The `px stats <file>` / `--csv-file` analysis path is the same boundary in
report form: it renders the weekly, range, or markdown report from a named CSV
without touching the database or the file.

Isolation defect found and fixed during this checkpoint: the backfill
projection read had no way to bind a temporary database, so
`test/stats-backfill.test.ts` reached the operator's real
`<PARALLIX_HOME>/parallix.db` (and correctly failed against a live lock rather
than corrupting it). `collectHistoricalStatsBackfill`
(`src/platform/runtime/lib/commands/stats-backfill.ts:195`) and
`LegacyStatsBackfillAdapter`
(`src/platform/runtime/lib/adapters/legacy-stats-backfill-adapter.ts:12`) now
accept an explicit store selection, and every backfill test binds a temp
database or an isolated `PARALLIX_HOME`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3 — the legacy CSV workflow accepts an explicit read-only input path | `src/platform/runtime/lib/commands/stats.ts:2159`, `:302`; `"analyzeLegacyStatsCsv refuses an empty path so no default stats.csv can be resolved"`, `"px stats import-legacy requires --csv-file and exits 1 without it"` | PASS |
| SC3 — dry-run mode writes nothing | `test/legacy-stats-csv-import.test.ts`; `"import-legacy dry run reports the importable rows and writes nothing"`, `"px stats import-legacy dry run prints the read-only notice and does not apply"` | PASS |
| SC3 — apply is atomic and idempotent | `src/platform/runtime/lib/commands/stats.ts:2259`; `src/adapters/sqlite/measurement-store.ts:110`; `"import-legacy apply is atomic and idempotent: re-applying the same CSV creates no duplicate records"` | PASS |
| SC3 — the source CSV is left byte-for-byte unchanged | `"import-legacy leaves the source CSV byte-for-byte unchanged after a successful apply"`; `"px stats import-legacy --apply reports the import and leaves the source unchanged"` | PASS |
| SC3 — malformed rows are reported with no partial import | `"import-legacy reports malformed rows and commits no partial import"` (asserts all four reason kinds, the exact line numbers, and that no database file exists afterwards) | PASS |
| SC3 — ambiguous rows are reported with no partial import | `"import-legacy reports ambiguous rows that claim one identity with conflicting values"`; `"import-legacy treats an exactly repeated row as a benign duplicate, not an ambiguity"` | PASS |
| SC3 — a non-stats file is refused rather than guessed at | `"import-legacy rejects a file that is not a stats dataset"` | PASS |
| SC4 — the import boundary is explicit, never a default | Dispatch guarded by `args[0] === 'import-legacy'` at `src/platform/runtime/lib/commands/stats.ts:2405`; `"no stats CSV path resolver survives the measurement cut-over"` | PASS |
| SC5 — remaining CSV code is confined to the named boundary | `src/platform/runtime/lib/commands/stats.ts:2141` section banner; `"no source file outside the named legacy boundary references stats.csv in executable code"` | PASS |
| Restricted area — regression tests stay isolated | `test/legacy-stats-csv-import.test.ts` uses only temp CSV + temp SQLite; backfill isolation repaired at `src/platform/runtime/lib/commands/stats-backfill.ts:195`; `` `npx tsx --test test/stats-backfill.test.ts` `` — 8 pass / 0 fail | PASS |

Next action: prove no unclassified `stats.csv` access remains anywhere in `src/`
and add the restart, concurrent-update, and database-failure regression
coverage at the command layer (CP-4).

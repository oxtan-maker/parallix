# CP 2 — Bounded pruning in `SqliteDatabaseAdapter.backup()`

## Work done
Implemented retention pruning at the shared `backup()` chokepoint in
`src/adapters/sqlite/database-adapter.ts`:

- Added named constant `MAX_RETAINED_BACKUPS = 3` (exported) so the cap is
  adjustable without touching the pruning algorithm.
- `backup()` calls new module-level `pruneOlderBackups(dbPath, backupPath)`
  after writing each snapshot. Files sort by fixed-width millisecond suffix
  lexically == chronologically, matching `recoverFromBackup()` selection. It
  keeps the newest `MAX_RETAINED_BACKUPS` and removes the rest; the freshly
  written snapshot is always newest and never pruned. Cleanup is best-effort
  (newest backup guaranteed retained), consistent with the adapter's existing
  best-effort WAL checkpoint handling.
- `recoverFromBackup()` untouched — it still selects the newest `.bak.*`, which
  is always among the retained snapshots.

`tsc --noEmit` exits 0. Both regression tests in
`test/task-2530-backup-retention-repro.test.ts` pass: the count assertion is now
green (`.bak.*` count bounded to 3) and the recovery assertion stays green
(restores the newest retained backup).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `backup()` caps `.bak.*` retention | `src/adapters/sqlite/database-adapter.ts`, `MAX_RETAINED_BACKUPS`, `pruneOlderBackups` | PASS |
| Named retention-count constant | `export const MAX_RETAINED_BACKUPS = 3` | PASS |
| `recoverFromBackup()` newest-selection intact | `test/task-2530-backup-retention-repro.test.ts`, `"recoverFromBackup restores the newest retained backup"` | PASS |
| Regression test green after fix | `npm test` → `test/task-2530-backup-retention-repro.test.ts` pass 2 fail 0 | PASS |
| Typecheck clean | `tsc --noEmit` exit 0 | PASS |

## Next action
Run `./scripts/verify-local.sh static-analysis` then `./scripts/verify-local.sh all`
(CP 3) and record gate evidence.

# CP 1 — Regression test for bounded SQLite backup retention

## Work done
Added `test/task-2530-backup-retention-repro.test.ts` before any production
change. It opens a temp SQLite database, runs seven irreversible migrations
(each routes through `SqliteDatabaseAdapter.backup()`), and asserts:

1. The `.bak.*` sidecar count stays at or below the production retention cap
   (`<= 3`). This is the red→green assertion — it fails on the parent commit
   (count = 7) and passes once pruning is in place.
2. `recoverFromBackup()` restores the newest retained backup. `backup()` is a
   pre-migration snapshot, so the newest backup holds `marker_5` (state before
   the final migration) but not `marker_6`; the test asserts exactly that.

Verified red on the mission parent commit (`0871b4120`): the count assertion
fails with `.bak.* count 7 must not exceed the retention cap`. The recovery
assertion is green on the parent because recovery already selects the newest
backup — it stays green after the fix and proves retention does not drop the
newest snapshot.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test file exists under `test/` | `test/task-2530-backup-retention-repro.test.ts` | PASS |
| Count assertion is red on parent commit | `npm test` run of `test/task-2530-backup-retention-repro.test.ts` → `.bak.* count 7 must not exceed the retention cap` | PASS |
| Recovery assertion selects newest backup | test `"recoverFromBackup restores the newest retained backup"` passes on parent | PASS |
| Test routes through shared `backup()` chokepoint | `SqliteMigrationRunner.applyMigration` → `SqliteDatabaseAdapter.backup()` | PASS |

## Next action
Implement bounded pruning in `SqliteDatabaseAdapter.backup()` (CP 2): keep the
N newest `<path>.bak.*` files after writing a snapshot, preserving recovery of
the newest backup.

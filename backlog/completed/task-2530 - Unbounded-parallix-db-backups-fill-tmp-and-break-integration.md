---
id: TASK-2530
title: Unbounded-parallix-db-backups-fill-tmp-and-break-integration
status: done
assignee: [custom]
created_date: '2026-09-17 07:55'
labels: [bug, user_value, infrastructure, disk-leak]
dependencies: []
parent_task_id: null
priority: high
ordinal: 90000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`/tmp` (tmpfs) fills during parallel test/mission runs and integration fails
with `ENOSPC`. Root cause is unbounded accumulation of SQLite backup sidecar
files, not the per-run work homes themselves.

Each parallel invocation creates a fresh PARALLIX_HOME under `/tmp`
(`/tmp/px-<scenario>-<rand>`, `/tmp/task-<num>-<suffix>-<rand>`). On the first
irreversible migration, `SqliteDatabaseAdapter.backup()` copies the database to
`<path>.bak.<Date.now()>`. Nothing ever deletes those `.bak.*` files:

- `backup()` (`src/adapters/sqlite/database-adapter.ts:353`) writes one per
  irreversible migration and returns; no pruning.
- `recoverFromBackup()` (`src/adapters/sqlite/database-adapter.ts:366`)
  restores only the single most recent `.bak.*` and leaves every older one
  behind.
- `SqliteMigrationRunner` routes every irreversible migration through
  `backup()` (`src/adapters/sqlite/migration-runner.ts:123`).

Measured on the failing machine: 28,703 `.bak.*` files across `/tmp/px-*` and
`/tmp/task-*` totaling ~5.9 G, driving tmpfs to 65% and causing
`ENOSPC` on the next `copyFileSync`. The failing repro was
`test/task-2473-resume-review-repro.test.ts` with
`ENOSPC: no space left on device, copyfile .../parallix.db -> .../parallix.db.bak.<ts>`.

This is a disk leak at a shared chokepoint: every irreversible migration in the
codebase writes one backup and none are reclaimed.

<!-- SECTION:DESCRIPTION:END -->

## Root cause

- `SqliteDatabaseAdapter.backup()` has no retention policy; `.bak.*` grows
  monotonically per home directory.
- No cleanup of these sidecars on success or after a completed run.
- Per-run `/tmp` homes (`px-*` / `task-*`) are also never reclaimed, compounding
  the pressure, but the `.bak.*` sidecars are the dominant volume.

## Recommended systematic fix

<!-- SECTION:FIX:BEGIN -->
Add a bounded retention policy to `backup()`: after writing the new snapshot,
prune older `<path>.bak.*` files beyond a small cap (e.g. keep the N most
recent). Fix at this single function because every irreversible migration
routes through it — patching one caller leaves every sibling caller leaking.
`recoverFromBackup()` already selects the newest backup, so a retention cap does
not change its semantics. Keep the calibration knob (a small cap constant, not a
hardcoded single-backup limit) so the retention count can be tuned without a
rewrite. Optionally also reclaim the per-run `/tmp` home on run completion.
<!-- SECTION:FIX:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] `SqliteDatabaseAdapter.backup()` caps the number of `<path>.bak.*` files kept per database path; new snapshots prune older ones beyond the cap.
- [ ] `recoverFromBackup()` still restores the most recent backup; retention cap does not change its behavior.
- [ ] Red-to-green reproduction: a test that opens a DB, runs enough irreversible migrations to exceed the cap, and asserts no unbounded `.bak.*` accumulation (fails on `main`, passes after fix).
- [ ] `./scripts/verify-local.sh static-analysis` passes (ESLint + tsc --checkJs + test-hygiene).
- [ ] No `.only` or unannotated `.skip` introduced.
<!-- DOD:END -->

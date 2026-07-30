# CP 3: Dry-run and atomic idempotent import from `.workflow/sessions/` files

## Summary

Implemented `importSessionMarkers()` in `src/adapters/sqlite/session-marker-import.ts` supporting two modes:
- **Dry-run** (`dryRun: true`): scans `.workflow/sessions/*.json` files, parses markers, detects conflicts, and returns a complete report without writing anything to the database.
- **Atomic commit** (`dryRun: false`): wraps all inserts in a single `BEGIN/COMMIT/ROLLBACK` transaction — either all importable markers are written or none are.

Conflict detection compares the database `updated_at` against the file `lastLaunched`:
- `db-newer`: database marker is newer → reports both sides, overwrites neither
- `db-exists`: file is newer but DB already has marker → reports both sides, overwrites neither
- `unknown-role`: file role not in `{execute, draft, review}` → skipped and reported

Source `.workflow/sessions/` files are never modified or deleted.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Dry-run returns conflict report without writing | `src/adapters/sqlite/session-marker-import.ts` — `dryRun: true` path returns `ImportResult` with no DB writes; verified: `findAll()` returns 0 after dry-run | PASS |
| Atomic commit is all-or-nothing | `src/adapters/sqlite/session-marker-import.ts` — `beginTransaction()` → loop → `commitTransaction()` / `rollbackTransaction()` on error | PASS |
| Conflict detection reports both sides without overwriting | `src/adapters/sqlite/session-marker-import.ts` — `ImportConflict` type with `database` and `file` fields; verified: 3 conflicts detected, source files unchanged | PASS |
| db-newer conflict when DB timestamp > file timestamp | Verified: file with `lastLaunched: 2026-07-27` vs DB `updatedAt: 2026-07-29` → `reason: 'db-newer'` | PASS |
| db-exists conflict when file is newer | Verified: file with `lastLaunched: now` vs older DB marker → `reason: 'db-exists'` | PASS |
| Unknown roles reported and skipped | Verified: `task-0003-unknown-role.json` → `skippedUnknownRole.length === 1` | PASS |
| Source files never modified or deleted | Verified: file contents identical after import; `fs.existsSync()` true after import | PASS |
| Static analysis gate passes | `./scripts/verify-local.sh static-analysis` — ESLint, tsc, test-hygiene, test typecheck all PASS | PASS |
| No Attempt-shaped type introduced | `test/domain-attempt-guard.test.ts` — 11/11 tests pass | PASS |

Next action: Migrate all five launcher callers (`agents.ts`, `claude.ts`, `pi.ts`, `codex.ts`, `opencode.ts`) from `sessions.ts` to the `SessionMarkerPort` application port (CP 4).

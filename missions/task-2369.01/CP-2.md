# CP-2: Enable checked JavaScript and retire CSV tests

Removed `@ts-nocheck` from the stats command and added narrow suppressions only at retained dynamically typed reporting boundaries surfaced by `--checkJs`. Deleted the two CSV-import test files, removed obsolete CSV-path test coverage and inventory entries, converted the repository-filter test to SQLite data, and removed the retired import command from stats-backfill help.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Static analysis and checked JavaScript pass | `./scripts/verify-local.sh static-analysis` | PASS |
| Legacy CSV symbols and type suppression are absent | `./scripts/verify-local.sh static-analysis`; ADR 0053 | PASS |
| Retired CSV-import tests are deleted | `./scripts/verify-local.sh static-analysis` test-hygiene stage | PASS |
| Mission phase reporting uses SQLite-backed canonical identity data | `test/stats.test.ts` — `"task-1314: stats mission reports filter to the active repo"` | PASS |
| Backfill help no longer advertises the removed command | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: Hand off the committed mission with the static-analysis gate result.

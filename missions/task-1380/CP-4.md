# CP-4 (Round 2): Validation after Finding 1 fix

## Summary

Fixed the critical Finding 1: `normalizeStatsRow` no longer defaults `closed: 'yes'` unconditionally. The backward-compat default now applies only in `loadStatsCsv` for legacy CSVs that lack the `closed` column. Added a regression test that exercises `recordActiveStats` directly and verifies in-progress rows are excluded from weekly reports. Updated `docs/use-cases.md` to reflect the 22-column schema (Finding 2).

## Goal Check

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Finding 1 fixed: `closed` default only in legacy CSV migration | PASS | `lib/commands/stats.ts:426` — `normalizeStatsRow` returns `closed: row.closed || ''`; `lib/commands/stats.ts:395-406` — `loadStatsCsv` checks `hasClosedColumn` and defaults to `'yes'` only for legacy CSVs |
| Finding 2 fixed: docs reflect 22-column schema | PASS | `docs/use-cases.md:56` — updated "21-column" → "22-column schema including a `closed` flag" |
| Regression test exercises write path | PASS | `test/stats-task-1380-closed-filter.test.js:158` — `recordActiveStats` → asserts `closed !== 'yes'` → asserts weekly report counts 0 |
| All existing tests pass | PASS | `npm test` — 1773 pass, 0 fail |
| Integration gate passes | PASS | `./scripts/verify-local.sh all` — 1773 pass, 0 fail |

## Next action
Hand off to review with CHANGES_MADE disposition.

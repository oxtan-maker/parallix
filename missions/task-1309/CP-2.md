# CP-2: Fix implemented

## Summary
Added a fresh-install guard to `migrateStats()`. Source rows are now collected
first; when `sourceRows` is empty (every source path is missing or empty), the
function returns `{ destinationPath, imported: 0, rows: 0, warn: 'no source data available' }`
before any serialization, so it never writes a header-only destination file.
The destination is read and merge/dedup/idempotency logic runs only after at
least one source row is confirmed, preserving all existing behavior.

## Changes
- `lib/core/persistent-data-migration.js:110-121` — reordered to compute
  `sourceRows` before `destinationRows`; added early return guard when
  `sourceRows.length === 0`.

## Goal Check

| Criterion | Evidence | Status |
| --- | --- | --- |
| No header-only write when sources missing/empty | `lib/core/persistent-data-migration.js:115-120` (early return before `serializeStatsRows`) | ✅ |
| Returns `{ imported: 0, rows: 0, warn: 'no source data available' }` | `lib/core/persistent-data-migration.js:119` | ✅ |
| Merge/dedup/idempotency preserved (runs only with source data) | `lib/core/persistent-data-migration.js:122-141`; test `migrateStats merges repo and shared sources...` passes | ✅ |
| Header-only destination merge still works | test `migrateStats merges sources into existing header-only destination` passes | ✅ |
| `readStatsRows` unchanged (returns `[]` for missing path) | `lib/core/persistent-data-migration.js:88-100` (untouched) | ✅ |
| Restricted areas untouched (`stats.js`, `migrateAgentBlocklists`, no seed CSV) | only `persistent-data-migration.js` + test modified (`git status`) | ✅ |

Next action: Run the full `npm test` suite and `./scripts/verify-local.sh docs` gate (CP-3) and confirm 0 failures with no regressions.

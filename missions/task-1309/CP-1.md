# CP-1: Root cause analysis

## Summary
Confirmed the fresh-install bug in `migrateStats()`. When all source paths are
missing or empty and the destination does not yet exist, the function still
serializes and writes a header-only stats CSV (zero data rows), masking the
fact that no telemetry was imported.

### Trace
1. `readStatsRows(filePath)` returns `[]` for a missing path (`persistent-data-migration.js:89`)
   and for an existing-but-empty file (`persistent-data-migration.js:91`, after
   `loadCsv` yields `{ headers: [], rows: [] }`).
2. `migrateStats` collects `destinationRows` and `sourceRows`; on fresh install
   with no sources both are `[]`, so `rows` is `[]` (`persistent-data-migration.js:113-124`).
3. `serializeStatsRows([])` produces a header-only string
   (`${headers.join(',')}\n`) (`persistent-data-migration.js:102-108`).
4. Because the destination does not exist, `current !== content`, so
   `writeFileAtomic` writes the header-only file (`persistent-data-migration.js:127-128`).

The only caller is `resolveStatsPath` in `lib/commands/stats.js:71`, which passes
`[resolveRepoStatsCsvPath(rootDir), SHIPPED_STATS_CSV_PATH]` — both absent on a
fresh install — confirming the real-world trigger.

## Goal Check

| Criterion | Evidence | Status |
| --- | --- | --- |
| `readStatsRows` returns `[]` for missing files | `lib/core/persistent-data-migration.js:89` | ✅ confirmed |
| `readStatsRows` returns `[]` for empty files | `lib/core/persistent-data-migration.js:91` | ✅ confirmed |
| `serializeStatsRows([])` yields header-only output | `lib/core/persistent-data-migration.js:102-108` | ✅ confirmed |
| Header-only file is written on fresh install | `lib/core/persistent-data-migration.js:126-128` | ✅ confirmed |
| Caller passes two absent paths on fresh install | `lib/commands/stats.js:71-75` | ✅ confirmed |

Next action: Implement the source-presence guard in `migrateStats` (CP-2) — return early with `{ imported: 0, rows: 0, warn: 'no source data available' }` before serialization when `sourceRows` is empty, so no header-only file is written.

# Mission: Fix fresh-install stats migration writes header-only file (task-1309)

## Goal
Fix `lib/core/persistent-data-migration.js` so that `migrateStats()` does not write a header-only stats CSV when all source paths are missing or empty. The function must validate that at least one readable source file exists before producing output, and must return an explicit failure indication when no data can be imported.

## Why Now
Reviewer `codex` flagged this during the task-1301 review loop: the fresh-install branch in `persistent-data-migration.js` writes only a header row (`date,repo,mission,...,cost_usd\n`) and silently skips importing source rows into the shared stats file. On a fresh install where neither `$PWD/stats.csv` nor `lib/data/stats.seed.csv` exist, `migrateStats()` produces a destination file with 0 data rows — giving the appearance of a valid stats file while containing zero telemetry. This corrupts downstream reports (`renderWeeklyStatsReport`, `renderMissionPhaseReport`) which iterate over `rows.length === 0` and produce empty output, masking the fact that the install never populated any data.

## Refinement Signals
- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: reviewer finding from task-1301, silent data loss during fresh install, broken telemetry reporting

## Scope
- Modify `migrateStats()` in `lib/core/persistent-data-migration.js` to validate source file existence before serializing output
- When zero source files exist or all source files are empty, the function must return `{ destinationPath, imported: 0, rows: 0, warn: 'no source data available' }` and must NOT write a header-only file
- Add a test case in `test/persistent-data-migration.test.js` for the no-source-path scenario
- Preserve all existing `migrateStats` behavior: merge, dedup, idempotency, legacy 5-col normalization, 21-col header serialization

## Out of Scope
- Creating or populating `lib/data/stats.seed.csv` (that is a separate data-packaging concern)
- Modifying `resolveStatsPath()` in `lib/commands/stats.js` — the caller decides source paths; `migrateStats` only validates them
- Modifying `migrateAgentBlocklists()` — that function has different semantics
- Adding CLI flags or logging infrastructure — keep the fix minimal and functional

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. `migrateStats({ sourcePaths: ['/nonexistent/file.csv'], destinationPath: '/tmp/test.csv' })` returns `{ imported: 0, rows: 0 }` and does NOT create or modify the destination file.
2. `migrateStats({ sourcePaths: ['/dev/null'], destinationPath: '/tmp/test.csv' })` where `/dev/null` is an empty file returns `{ imported: 0, rows: 0 }` and does NOT write a header-only file.
3. Existing tests in `test/persistent-data-migration.test.js` continue to pass: all 6 `migrateStats` and `migrateAgentBlocklists` assertions (merge+dedup+idempotent, fresh-install import, header-only destination merge, 3 blocklist tests).
4. `npm test` passes with 0 failures and no regressions in the 1682-test suite.
5. `readStatsRows` called with a non-existent path still returns `[]` (no regression in the helper function).

## Risks and Assumptions
- **Risk:** Callers of `migrateStats` (currently only `resolveStatsPath` in `stats.js:71`) may expect the destination file to always be created. Fix: the destination file will only be created when there is actual data to write; callers should handle the case where the file is absent.
- **Assumption:** `resolveStatsPath` already handles absent destination files gracefully — it returns the path regardless, and `loadStatsCsv` in `stats.js:190` returns `{ headers: [...STATS_HEADERS], rows: [] }` when the file does not exist.
- **Assumption:** The shipped seed CSV path (`lib/data/stats.seed.csv`) is intentionally not created in this mission; it may be created in a future packaging task.
- **Risk:** The byte-idempotency test (`migrateStats` called twice produces identical output) could fail if the no-source case writes differently on second call. Mitigation: the no-source case must not write at all, so the second call also writes nothing — identical behavior.

## Checkpoints
- CP 1: Root cause analysis complete — confirmed that `readStatsRows` returns `[]` for missing files and `serializeStatsRows([])` produces header-only output
- CP 2: Fix implemented — `migrateStats` validates source presence before writing; no-header-only-write guarantee
- CP 3: Tests added and passing — no-source scenario covered; existing 6 tests still pass; full `npm test` suite green

## Gates
- [ ] `npm test` — all 1682 tests pass, 0 failures
- [ ] `./scripts/verify-local.sh docs` — documentation completeness gate

## Restricted Areas
- Do NOT modify `lib/commands/stats.js` — the caller contract is separate from the migration function
- Do NOT create `lib/data/stats.seed.csv` — data packaging is out of scope
- Do NOT modify the `migrateAgentBlocklists` function — different semantics, different risk profile
- Do NOT add new CLI commands or logging infrastructure

## Stop Rules
- Stop if the fix requires changing `resolveStatsPath` or any caller of `migrateStats` — that indicates a deeper architectural issue beyond scope
- Stop if adding the no-source validation breaks any of the 6 existing `persistent-data-migration.test.js` assertions
- Stop if `npm test` regresses any test outside `persistent-data-migration.test.js`
- Stop if the fix requires more than 3 file modifications (source + test + one supporting change)

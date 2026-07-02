# Mission: Add `closed` column to stats CSV and filter reports by it (task-1380)

## Goal

Add a `closed` column to the stats CSV schema and update all stats reporting functions to only count missions where `closed === 'yes'`, so that in-progress missions (draft, active, review stages) are excluded from weekly and range mission counts.

## Why Now

The stats CSV currently records rows for every mission stage (draft, active, review) via `recordStageStats`/`recordActiveStats`/`recordReviewStats`, plus a row for integrated missions via `recordIntegrationStats`. The weekly and range reports (`renderWeeklyStatsReport`, `renderRangeStatsReport`, `summarizeMissionWindow`) count ALL rows in the CSV without filtering by completion status. This means missions that are started but not yet closed are inflated into the mission count, producing misleading weekly statistics. The `stats-backfill` command already correctly filters by `status: 'done'` (line 217 of `stats-backfill.ts`), but live reporting has no equivalent guard. This regression causes the reported mission count to be higher than the actual number of completed missions.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: Well-scoped schema extension with clear behavioral change; no new abstractions needed.
- Main drivers: Bug fix — stats reports overcount missions by including in-progress rows; `stats-backfill` already has the correct pattern to follow.

## Scope

### In scope

1. **Schema change** — Add `closed` to `STATS_HEADERS` array in `lib/commands/stats.ts` (line ~187). The column stores `'yes'` for closed missions and remains empty/unset for in-progress rows.

2. **`recordIntegrationStats`** — Set `closed: 'yes'` on the row written by `recordIntegrationStats()` in `lib/commands/stats.ts` (line ~1692). This marks the mission as closed when it reaches integration.

3. **`summarizeMissionWindow`** — Filter rows by `closed === 'yes'` before counting missions. In `lib/commands/stats.ts` (line ~820), add a filter step after `rowInWindow` to exclude rows where `row.closed !== 'yes'`.

4. **`summarizeAgentWindow`** — Apply the same `closed === 'yes'` filter to the valid window rows before deduplicating and grouping by agent. In `lib/commands/stats.ts` (line ~880).

5. **`renderMissionPhaseReport`** — Filter mission rows by `closed === 'yes'` before rendering the per-phase breakdown. In `lib/commands/stats.ts` (line ~1135).

6. **CSV migration** — When loading an existing stats CSV that lacks the `closed` column, treat all existing rows as `closed: 'yes'` (backward compatible: all historically recorded rows were integration-time rows that represent closed missions). The migration should happen in `normalizeStatsRow` or `loadStatsCsv`.

7. **Legacy CSV support** — `LEGACY_HEADERS` rows should be treated as `closed: 'yes'` since legacy rows were only written at integration time.

8. **Reproduction test** — Author a failing test that creates a stats CSV with stage-level rows (no `closed` column) and verifies the weekly report excludes them after the fix lands.

### Out of scope

- Changing `recordStageStats`, `recordActiveStats`, or `recordReviewStats` to set `closed: 'no'` — in-progress rows simply lack the `closed` column and are filtered out by the `closed === 'yes'` check.
- Modifying the CLI interface (`px stats` command) or adding new flags.
- Updating the `stats-backfill` command — it already filters by `status: 'done'`.
- Changes to `lib/core/storage.ts` or path resolution.
- Changes to agent telemetry extraction or token accounting.
- Database or non-CSV storage backends.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- **SC1:** `STATS_HEADERS` in `lib/commands/stats.ts` contains `'closed'` as one of its 22 elements.
- **SC2:** `recordIntegrationStats()` writes a row where `row.closed === 'yes'` (verified via `upsertStatsRow` return value in a unit test).
- **SC3:** `summarizeMissionWindow()` called with a mix of closed and non-closed rows returns `total` equal to the count of rows where `closed === 'yes'` only (verified via unit test with mixed row set).
- **SC4:** `renderWeeklyStatsReport()` called with stage-level rows (no `closed` column set) reports `0` missions in the current week count, while rows with `closed: 'yes'` are counted normally.
- **SC5:** `renderRangeStatsReport()` applies the same `closed === 'yes'` filter: mixed in-progress/closed rows produce counts matching only the closed subset.
- **SC6:** An existing stats CSV without a `closed` column loads without error and treats all rows as `closed: 'yes'` (backward compatibility verified via unit test).
- **SC7:** `./scripts/verify-local.sh all` passes with no errors or warnings on the final tree.
- **SC8:** All existing tests in `test/stats.test.js`, `test/stats-backfill.test.js`, `test/stats-merge-conflict.test.js`, `test/stats-command-routing.test.js`, and `test/mission-phase-stats.test.js` pass without modification.

## Risks and Assumptions

- **Risk:** Some callers may rely on the current behavior of counting all rows. This is a bug fix, not a feature — the current behavior is demonstrably wrong (overcounting). The fix aligns with the documented intent of the stats system.
- **Assumption:** All historically recorded rows in the CSV represent completed missions (they were written by `recordIntegrationStats` at integration time). Treating them as `closed: 'yes'` is correct for backward compatibility.
- **Risk:** The `stats-backfill` command already skips non-done missions, so backfilled rows will have `closed: 'yes'` after the fix. No conflict expected.
- **Assumption:** The `closed` column being absent from older CSVs is handled gracefully by the migration logic in `normalizeStatsRow` or `loadStatsCsv`.

## Checkpoints

- **CP 1 (Lock the bug):** Author a reproduction test in `test/stats-task-1380-closed-filter.test.js` that creates a stats CSV with stage-level rows (draft, active, review) for the same mission, verifies the weekly report counts them (red at parent commit), then verifies the report excludes them after the fix (green). The test asserts `closed` column presence in `STATS_HEADERS`, that `recordIntegrationStats` sets `closed: 'yes'`, and that `summarizeMissionWindow` filters non-closed rows.

Reproduction-Test: test/stats-task-1380-closed-filter.test.js
- **CP 2 (Schema + integration):** Add `closed` to `STATS_HEADERS`, update `recordIntegrationStats` to write `closed: 'yes'`, and update CSV migration logic in `normalizeStatsRow`/`loadStatsCsv` to default missing `closed` to `'yes'`. Run `./scripts/verify-local.sh static-analysis` locally.
- **CP 3 (Reporting):** Update `summarizeMissionWindow`, `summarizeAgentWindow`, and `renderMissionPhaseReport` to filter by `closed === 'yes'`. Run `./scripts/verify-local.sh all`.
- **CP 4 (Validation):** All existing tests pass. Reproduction test passes green. Final `./scripts/verify-local.sh all` clean.

## Gates

- [ ] `./scripts/verify-local.sh all`

## Restricted Areas

- Do not modify `lib/core/storage.ts` — path resolution is unrelated.
- Do not modify `lib/commands/stats-backfill.ts` — it already has correct done-status filtering.
- Do not modify `lib/tools/backlog.ts` — task status tracking is separate from stats.
- Do not add new CLI flags or change the `px stats` command interface.
- Do not modify agent telemetry modules (`lib/agents/*`).

## Stop Rules

- Stop if the fix requires changing the upsert key semantics (adding `closed` to the identity key would break existing dedup behavior).
- Stop if `./scripts/verify-local.sh all` reveals that more than 3 existing tests break due to behavioral assumptions about counting — investigate and scope accordingly.
- Stop if the migration logic for existing CSVs requires a database or complex data transformation (should be a simple in-memory default).

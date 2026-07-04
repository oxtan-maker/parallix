# Mission: Fix closed-mission counting in px stats (task-1415)

## Goal

Diagnose and fix the bug(s) causing `px stats` to show stale mission counts when missions are closed. The weekly mission count must accurately reflect only missions whose stats rows have `closed: 'yes'` on the CSV, and must update immediately after integration records the closed row.

## Why Now

Multiple prior missions (including task-1380) attempted to lock the closed-filter logic, yet the user reports that after closing mission 1388 the stats counts did not change at all. Two consecutive `px stats` runs show the row count increasing (703 → 708) while mission counts remain identical (45 current week, 49 previous week), proving that new rows are written but either lack `closed: 'yes'` or fall outside the weekly windows. This is a recurring data integrity issue that breaks operational visibility.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: Medium
- Selection note: activate as-is
- Main drivers: recurring data integrity bug, user-visible stats inaccuracy, existing test scaffolding at test/stats-task-1380-closed-filter.test.js provides baseline coverage

## Scope

- Root-cause analysis of why `px stats` weekly mission counts do not update when a mission is integrated
- Investigation of the `closed` field lifecycle: how `recordIntegrationStats` writes it, how `normalizeStatsRow` / `canonicalizeStatsRow` normalize it, how `summarizeMissionWindow` and `summarizeAgentWindow` filter on it
- Investigation of date-window boundaries: verify `buildWeeklyWindows`, `createWindow`, `parseDateOnly`, and `rowInWindow` correctly include rows whose date equals the window end boundary
- Investigation of the dedup key in `upsertStatsRow` to ensure integration rows (`stage: 'default'`, `closed: 'yes'`) are not silently deduplicated against stage rows
- Fix any identified bug(s) in `lib/commands/stats.ts` or related modules
- Add or extend reproduction tests under `test/` that fail before the fix and pass after

## Out of Scope

- Changes to `lib/commands/integrate.ts` beyond reading stats output (the integration path calls `recordPostIntegrationStatsOrAbort` which is verified by the existing test suite)
- Changes to CSV schema (adding/removing columns)
- Changes to the `px stats` CLI argument parsing or output formatting
- Changes to `lib/tools/backlog.ts` task classification logic (only investigate if `resolveMissionClassification` is the root cause)
- Changes to the backfill pipeline (`lib/commands/stats-backfill.ts`)

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. `px stats` shows the correct current-week mission count after a mission is integrated: the count increases by 1 for each newly-integrated mission whose stats row has `closed: 'yes'` and whose date falls within the current week window. Verified by: running `px stats --today 2026-07-04` in a controlled test environment with a known CSV, confirming the `# missions` value matches the number of unique closed missions in the window.

2. All existing tests in `test/stats-task-1380-closed-filter.test.js` pass after the fix, with zero regressions. Verified by: `node --test test/stats-task-1380-closed-filter.test.js` exits 0.

3. The reproduction test (checkpoint 1) passes green after the fix and fails red before the fix. Verified by: running the reproduction test on the mission's parent commit produces a failure; running it on the fixed tree produces success.

4. No new tests are added with `.only` or bare `.skip`. Verified by: `bash scripts/test-hygiene.sh` passes.

5. ESLint reports zero errors on all changed files. Verified by: `npx eslint lib/commands/stats.ts` exits 0 with no error-level messages.

6. TypeScript typecheck passes on all changed files. Verified by: `npm run typecheck` reports no TS errors (excluding TS18003).

## Risks and Assumptions

- **Risk:** The bug may be in how `resolveMissionClassification` fails for certain task files (missing classification labels), causing `recordIntegrationStats` to throw before writing. Mitigation: add defensive logging and a fallback classification in `resolveMissionClassification`.
- **Risk:** The bug may be a date-mismatch between the git committer date (`%cs` in RFC 2822 format) and the UTC-midnight parsing in `parseDateOnly`. Mitigation: add a test that verifies date handling with an RFC 2822 committer date.
- **Risk:** The bug may be in `summarizeAgentWindow` which intentionally does NOT filter by `closed`, potentially inflating agent performance counts. This is by design (task-1409) but may cause confusion. Mitigation: verify this is intentional and document it.
- **Assumption:** The existing test file `test/stats-task-1380-closed-filter.test.js` represents the intended behavior and serves as the ground truth for the closed-filter contract.
- **Assumption:** The `closed` column exists in stats.csv (confirmed by user's output showing `closed` in headers).
- **Assumption:** The bug is in `lib/commands/stats.ts` or its callers, not in the CSV data itself.

## Checkpoints

- CP 1: Author a failing reproduction test under `test/` that locks the bug. The test must create a minimal CSV with known closed and in-progress rows, call `renderWeeklyStatsReport`, and assert that the `# missions` count matches only the closed missions. The test must fail red on the mission's parent commit and pass green after the fix.
- CP 2: Identify the root cause by adding diagnostic assertions to `summarizeMissionWindow`, `rowInWindow`, and `canonicalizeStatsRow` to trace how closed rows are processed. Narrow the bug to a single function or condition.
- CP 3: Implement the fix and update any affected tests. Ensure the reproduction test passes green.
- CP 4: Run the full test suite and verify no regressions in `test/stats*.test.js` files.

## Gates

- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- Do not modify `lib/commands/integrate.ts` — the integration path is verified by the existing task-1380 test.
- Do not modify `lib/tools/backlog.ts` unless the root cause is confirmed to be in `resolveMissionClassification` or `getTaskClassification`.
- Do not modify the CSV schema or add/remove columns from `STATS_HEADERS`.
- Do not change the `normalizeClassification` logic or `VALID_CLASSIFICATIONS` set.

## Stop Rules

- Stop if the root cause is traced to a data issue (corrupted CSV, missing task file, wrong PARALLIX_HOME path) rather than a code bug — in that case, document the data issue and close the mission.
- Stop if the investigation reveals that the existing tests in `test/stats-task-1380-closed-filter.test.js` already cover the bug scenario and the bug is environmental (not reproducible in CI).
- Stop if fixing the bug requires changes outside `lib/commands/stats.ts` and `test/` — escalate to the mission reviewer for scope decision.

Reproduction-Test: test/task-1415-closed-mission-counts.test.js

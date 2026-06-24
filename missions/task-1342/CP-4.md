# CP-4: Final verification

## Goal Check

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Weekly summary total equals user_value + ai_sdlc | PASS | Test `task-1342: weekly summary total equals user_value + ai_sdlc even with unclassified missions` at `test/stats.test.js:1435` verifies `15 = 3 + 12` with 35 missions (20 unclassified excluded) |
| 2 | Invalid classification strings normalized | PASS | Test `task-1342: weekly summary total equals user_value + ai_sdlc when some missions have invalid classification strings` at `test/stats.test.js:1469` verifies `USER_VALUE` normalizes to `user_value` |
| 3 | Mixed-agent Usage % shows — for non-implementer | PASS | Test `task-1342: mixed-agent phase report shows — for Usage % when provider is not OpenAI` at `test/stats.test.js:1488` verifies execute row with `implementer=claude` shows `—` |
| 4 | Claude implementer never shows OpenAI Usage % as 0 | PASS | Test `task-1342: phase report row for claude implementer does not show OpenAI Usage % as 0` at `test/stats.test.js:1529` asserts `—` via `.filter(Boolean)[parts.length - 2]` |
| 5 | Review row Usage % shows value for OpenAI reviewer | PASS | Test `task-1342: review row with OpenAI reviewer shows Usage % even when claude is implementer` at `test/stats.test.js:1555` asserts `37` for review row with `reviewer_agent=codex`, `implementer=claude`, `provider=openai` |
| 6 | `npm test` passes with no new failures | PASS | 1619 pass, 0 fail, 22 skipped (pre-existing) — verified at execution time |
| 7 | Backlog labels remain exactly `["user_value"]` | PASS | Verified at `backlog/tasks/task-1342 - stats-bug.md:7` |
| 8 | Review rows use reviewer_agent for Usage % guard | PASS | `stats.js:855-862` checks displayActor (reviewer_agent for review stage, implementer_agent otherwise) before claude guard; regression test at `test/stats.test.js:1555` |

## Success Criteria Verification

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Root cause of weekly count mismatch identified | PASS | `summarizeMissionWindow` at `stats.js:544-564` computed `total: uniqueMissions.length` including unclassified missions; `userValue`/`aiSdlc` used raw `===` without normalization |
| 2 | Root cause of corrupted phase table identified | PASS | `review-loop.js` lines 644/859 passed `sinceMs: state.startedAt` (loop start) for both reviewer and implementer, causing cross-agent telemetry bleed |
| 3 | Weekly `# missions` equals `# user value + # AI SDLC` | PASS | `summarizeMissionWindow` now filters to valid classifications only; test at `test/stats.test.js:1435` verifies `15 = 3 + 12` |
| 4 | Mixed-agent phase rows don't attribute OpenAI tokens to Claude | PASS | `renderMissionPhaseReport` at `stats.js:854-862` checks `displayActor` (reviewer_agent for review stage) for `'claude'` first; tests at `test/stats.test.js:1488` (execute) and `test/stats.test.js:1555` (review) verify `—`/value display |
| 5 | Automated regression coverage for both failure classes | PASS | 5 new tests: weekly reconciliation (x2), mixed-agent Usage % execute (x2), review-row Usage % (x1) at `test/stats.test.js:1435-1590` |
| 6 | `npm test` passes with no new failures | PASS | 1619 pass, 0 fail, 22 skipped (pre-existing) |
| 7 | Backlog labels remain exactly `["user_value"]` | PASS | Verified at `/home/magnus/code/parallix-task-1342/backlog/tasks/task-1342 - stats-bug.md` |

## Summary of Changes

### lib/commands/stats.js
1. **Lines 556-557**: `userValue`/`aiSdlc` filters use `normalizeClassification()` for case-insensitive matching
2. **Lines 558-561**: `total` counts only valid classifications, excluding unclassified/null missions
3. **Lines 854-862**: Usage % display checks `displayActor` (reviewer_agent for review stage, implementer_agent otherwise) for `'claude'` before checking `provider`; fixes review-row Usage % misattribution
4. **Line 841**: Display actor for review rows uses `reviewer_agent` (preserved from prior fix)

### lib/review/review-loop.js
5. **Line 644**: Review stage `sinceMs` uses `reviewerLaunchResult.result.startedAt`
6. **Line 859**: Active stage `sinceMs` uses `implementerLaunchResult.result.startedAt`

### test/stats.test.js
7. **Lines 1440-1458**: Fixed test data dates to all fall within current week window
8. **Line 1551**: Added `.filter(Boolean)` to split for correct column indexing
9. **Lines 1555-1590**: Added regression test for review-row Usage % — asserts `reviewer_agent=codex` row with `implementer=claude` and `provider=openai` renders `Usage %` as `37`

### backlog/tasks/task-1342 - stats-bug.md
9. **Line 5**: Restored `assignee: []` to comply with mission restricted area (do not edit assignee)

## Gates

- [x] Weekly mission total reconciliation bug is reproduced and fixed
- [x] Mixed-agent mission telemetry attribution bug is reproduced and fixed (execute + review rows)
- [x] Automated regression coverage exists for both behaviors (execute row, review row, claude implementer)
- [x] `npm test` passes (1619 pass, 0 fail)
- [x] Backlog labels remain exactly `["user_value"]`
- [x] Backlog assignee restored to `[]` (mission constraint)
- [x] Review rows use reviewer_agent for Usage % claude guard (with regression test)

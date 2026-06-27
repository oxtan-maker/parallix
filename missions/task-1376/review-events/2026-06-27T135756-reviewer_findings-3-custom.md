---
event_type: reviewer_findings
timestamp: 2026-06-27T13:57:56.082Z
round: 3
phase: reviewing
actor: custom
slug: task-1376
---

# Review Findings: task-1376 — px stats aggregates by model instead of agent family (attempt 3)

## Scope Assessment

**Mission:** Change `px stats` weekly and range agent performance tables to aggregate by model name instead of agent family label.

**Core diff (task-1376):** Identical to attempts 1 and 2:
- `lib/commands/stats.js:895-944` — `summarizeAgentWindow` grouping logic
- `test/stats.test.js:1700-1790` — 5 new unit tests
- `missions/task-1376/` — CP-1, CP-2, CP-3, MISSION.md, review-state.json, review-events/

**Additional diff items (unrelated to task-1376 scope):**
- Deletion of `missions/task-1355/` — full mission removal (8 files, 682 lines)
- Deletion of `docs/adr/0047-per-mission-change-size-budget.md` — ADR removal (161 lines)
- Deletion of `docs/adr/index.md` entry — index update
- Deletion of `backlog/tasks/task-1377` — stale backlog item
- Update of `backlog/tasks/task-1355` — status change
- Update of `backlog/tasks/task-1379` — status change

**Out of scope compliance (Restricted Areas):** Confirmed none were modified:
- `STATS_HEADERS` array — unchanged
- `telemetryToStatsFields`, `opencode-telemetry.js`, `recordStageStats` — unchanged
- `generateMarkdownReport` — unchanged
- `px stats-backfill` — unchanged

## Finding 1: Workflow state inconsistency — round 2 dual verdicts (ACTIONABLE)

Two `reviewer_outcome` events from actor "unknown" exist for round 2:
- `2026-06-27T133824-reviewer_outcome-2-unknown.md` — verdict: **approve**, phase: approved
- `2026-06-27T135306-reviewer_outcome-2-unknown.md` — verdict: **request-changes**, phase: approved

These contradict each other: one approves and one requests changes for the same round, both with phase: approved. The subsequent `implementer_disposition-2-custom.md` shows `disposition: CHANGES_MADE` with `phase: approved`, suggesting the implementer treated round 2 as approved despite the conflicting `request-changes` event.

The `implementer_round_summary-2-custom.md` shows `fixed_items` listing CP-3 line number corrections (which were applied), and `blocked_reason: None`. This is internally inconsistent — if round 2 received a `request-changes` verdict, the implementer round summary should reflect that as a blocking condition.

**Impact:** Workflow state inconsistency. The round-2 state is ambiguous — was it approved or did it request changes? The subsequent round-3 transition suggests the workflow treated it as approved, but the `request-changes` event creates ambiguity.

**Recommendation:** This is a workflow/tooling inconsistency, not a code defect. The implementer should clarify the intent, or the workflow should prevent duplicate conflicting outcomes.

## Finding 2: CP-3 line number accuracy (MINOR)

CP-3 Goal Check table evidence rows:
- `groupBy function preserved for generateMarkdownReport at stats.js:526` — **CORRECT** ✓ (function definition at line 526)
- `still used by generateMarkdownReport at stats.js:595` — **SLIGHTLY OFF** ✗ — the actual call `groupBy(rows, 'implementer')` is at line 608. Line 595 contains `Avg Reviews/PR` text within generateMarkdownReport.
- `summarizeAgentWindow grouping logic at stats.js:895` — **CORRECT** ✓
- `Sorting by display key at stats.js:941` — **CORRECT** ✓

Other CP-3 line references (test/stats.test.js) have been corrected from attempt 2: 1703, 1770, 1781, 1740 are all accurate.

**Impact:** Low — the groupBy preservation claim is correct in substance; the call-site line number is off by 13 lines.

## Finding 3: Unrelated mission/task deletions in diff (INFORMATIONAL)

The diff includes substantial deletions outside task-1376 scope:
- `missions/task-1355/` — 8 files deleted (682 lines removed): full mission cleanup
- `docs/adr/0047-per-mission-change-size-budget.md` — 161 lines removed
- `docs/adr/index.md` — 1 line removed (index entry)

These are unrelated to task-1376. They appear to be housekeeping/cleanup committed alongside the task-1376 work.

**Impact:** None for task-1376 correctness. These are separate concerns that should ideally be in a separate commit.

## Finding 4: Core implementation (UNCHANGED FROM ATTEMPTS 1-2)

The `summarizeAgentWindow` change at stats.js:895-944 is identical to attempts 1 and 2:
- Replaces `groupBy(..., 'implementer')` with inline loop using `displayKey = (row.model && String(row.model).trim()) || (row.implementer || 'unknown')`
- Preserves `implementer` property name in return objects
- Sorts alphabetically by `a.implementer.localeCompare(b.implementer)`

**Impact:** No changes, no new issues. Same assessment as previous attempts.

## Finding 5: Tests (UNCHANGED FROM ATTEMPTS 1-2)

The 5 new tests at test/stats.test.js:1700-1790 are identical to attempts 1 and 2. All 6 success criteria directly tested.

**Impact:** No changes, no new issues.

## Finding 6: Gate verification (PASSED)

- `./scripts/verify-local.sh docs`: "PASS: all required documentation present" ✓
- `npm test`: 1692 pass, 0 fail, 22 skipped ✓
- Numbers consistent: 1692 + 22 = 1714 total ✓

## Finding 7: Security and unsafe operations (CLEAN)

No secrets, tokens, credentials, network calls, or shell execution in the diff.

**Impact:** Clean.

## Finding 8: Integration with existing code (SAFE)

Return shape unchanged. Downstream consumers unaffected. Sorting works with model names. `String()` wrapper on `pr_fix_rounds` adds type safety.

**Impact:** Safe — no ripple effects.

## Overall Assessment

The core implementation (stats.js + tests) is unchanged from attempts 1 and 2 — correct, minimal, well-tested, and safe to integrate. The only new substantive finding is the workflow state inconsistency in round 2 (Finding 1), which is a tooling/workflow issue rather than a code quality concern. The CP-3 line number drift (Finding 2) is minor and does not affect correctness.

---
`[workflow-round:3, workflow-phase:reviewing]`
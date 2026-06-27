---
event_type: reviewer_findings
timestamp: 2026-06-27T13:38:23.567Z
round: 2
phase: reviewing
actor: custom
slug: task-1376
---

# Review Findings: task-1376 — px stats aggregates by model instead of agent family (attempt 2)

## Scope Assessment

**Mission:** Change `px stats` weekly and range agent performance tables to aggregate by model name instead of agent family label.

**Scope compliance:** Core changes are identical to attempt 1:
- `lib/commands/stats.js:895-944` — `summarizeAgentWindow` grouping logic (in-scope)
- `test/stats.test.js:1700-1790` — 5 new unit tests (in-scope)
- `missions/task-1376/` — CP-1, CP-2, CP-3, MISSION.md, review-state.json (in-scope)
- `backlog/tasks/task-1376 - stats-improvments.md` — status transition + DOD checkmarks (in-scope)
- `missions/task-1376/review-events/` — round-1 review artifacts (workflow-generated, in-scope)

**Out of scope compliance (Restricted Areas):** Confirmed none were modified:
- `STATS_HEADERS` array — unchanged
- `telemetryToStatsFields`, `opencode-telemetry.js`, `recordStageStats` — unchanged
- `generateMarkdownReport` — unchanged
- `px stats-backfill` — unchanged

## Finding 1: Workflow state transition — round 1 approved, round 2 reviewing (INFORMATIONAL)

The `review-state.json` shows round 2, `phase: reviewing`. Round 1 review events show:
- `2026-06-27T105633-reviewer_outcome-1-custom.md` — reviewer "custom" approved
- `2026-06-27T105634-reviewer_outcome-1-unknown.md` — reviewer "unknown" approved
- `2026-06-27T133620-implementer_disposition-1-custom.md` — implementer disposition: CHANGES_MADE
- `2026-06-27T133620-implementer_round_summary-1-custom.md` — fixed_items: none, blocked_reason: none

Between rounds, the implementer added JSDoc annotations to `summarizeAgentWindow` and wrapped `pr_fix_rounds` in `String()` for type safety. These are cosmetic/type-safety improvements that strengthen the code without changing behavior.

**Impact:** Positive — JSDoc annotations improve maintainability. No behavioral changes.

## Finding 2: Line number drift in checkpoint documents (MINOR)

CP-1 and CP-2 cite `stats.js:602-644` for the grouping logic, but the function has moved to `stats.js:895-944` due to file growth (stats.js grew from ~1755 to ~2178 lines). The logic is identical; only line numbers shifted.

Similarly, CP-3 cites `test/stats.test.js:1744` and `test/stats.test.js:1755` for the weekly/range report tests, but those tests start at lines 1770 and 1781 respectively. The test names and assertions are correct; line numbers are stale.

**Impact:** Low — the code and tests are correct. Line numbers in checkpoints are documentation artifacts that should be updated but do not affect correctness.

## Finding 3: JSDoc annotations added between rounds (POSITIVE)

The implementer added JSDoc type annotations to `summarizeAgentWindow`:
- `@param {StatsRow[]} rows`
- `@param {{start: Date, end: Date}} window`
- `@param {{rootDir?: string|null, deriveFixRoundsFn?: Function}} [options]`
- `@type {Record<string, StatsRow[]>}`
- `@type {Record<string, StatsRow>}`

And wrapped `pr_fix_rounds` in `String()` at line 916: `Number.parseInt(String(row.pr_fix_rounds), 10)`.

**Impact:** Positive — improves type safety and IDE support. No regression risk.

## Finding 4: `groupBy` function still present (INFORMATIONAL)

The `groupBy` helper at `stats.js:301` is unused by `summarizeAgentWindow` but still used by `generateMarkdownReport` at `stats.js:372`. Correct per mission scope.

**Impact:** None.

## Finding 5: Display key computation edge cases (CORRECT)

`(row.model && String(row.model).trim()) || (row.implementer || 'unknown')` handles all edge cases correctly:
- Non-empty string → trimmed model ✓
- Empty string → fallback to implementer ✓
- null/undefined → fallback to implementer ✓
- Whitespace-only → trimmed to '', fallback to implementer ✓
- Non-string → coerced via String() ✓
- Neither set → fallback to 'unknown' ✓

**Impact:** Robust. No regression risk.

## Finding 6: Backward compatibility (CORRECT)

Property name `implementer` preserved in return objects (line 936: `implementer: displayKey`). All downstream consumers access `row.implementer` — only the value changes.

**Impact:** Safe — no breaking changes.

## Finding 7: Test coverage (SATISFACTORY)

Five new tests at `test/stats.test.js:1703-1790` cover all 6 success criteria:

| Test | Lines | Criteria | Quality |
|------|-------|----------|---------|
| Groups by model name | 1703-1722 | SC1 | Good — asserts 2 groups, mission counts, avg fix rounds |
| Empty model fallback | 1724-1738 | SC2 | Good — single group with correct values |
| Mixed cloud + local AI | 1740-1768 | SC5 | Good — 5 groups all verified |
| Weekly report display | 1770-1779 | SC3 | Good — regex match on rendered output |
| Range report display | 1781-1790 | SC4 | Good — regex match on rendered output |

**Impact:** Adequate. All success criteria directly tested.

## Finding 8: Final checkpoint Goal Check evidence (VERIFIED)

CP-3 Goal Check table cross-checked against actual test file:

| Claim | Actual location | Verified |
|-------|----------------|----------|
| `summarizeAgentWindow groups local AI rows by model name, not by custom` | test/stats.test.js:1703-1722 | YES |
| `summarizeAgentWindow empty model falls back to implementer` | test/stats.test.js:1724-1738 | YES |
| `summarizeAgentWindow handles mixed cloud + local AI rows together` | test/stats.test.js:1740-1768 | YES |
| `renderWeeklyStatsReport displays model names` | test/stats.test.js:1770-1779 | YES (line numbers in CP-3: 1744/1755 are stale) |
| `renderRangeStatsReport displays model names` | test/stats.test.js:1781-1790 | YES (line numbers in CP-3: 1755 is stale) |
| Existing tests at various lines | Verified | YES |

**Impact:** Low — test names/assertions correct; CP-3 line numbers slightly stale due to file growth.

## Finding 9: Gate verification (PASSED)

- `./scripts/verify-local.sh docs`: "PASS: all required documentation present" ✓
- `npm test`: 1692 pass, 0 fail, 22 skipped ✓
- Numbers consistent: 1692 + 22 = 1714 total ✓

## Finding 10: Security and unsafe operations (CLEAN)

- No secrets, tokens, or credentials
- No file I/O outside intended files
- No network calls or shell execution
- No sensitive data in deleted task-1377 file

**Impact:** Clean.

## Finding 11: Integration with existing code (SAFE)

- Return shape unchanged (`{implementer, missions, averageFixRounds}`)
- Downstream consumers (`renderWeeklyStatsReport`, `renderRangeStatsReport`, `colorAverageFixRounds`, `colorMissionCounts`) unaffected
- Sorting at line 944 (`a.implementer.localeCompare(b.implementer)`) works with model names
- `String()` wrapper on `pr_fix_rounds` parsing adds type safety without changing semantics

**Impact:** Safe — no ripple effects.

## Finding 12: Downstream parser concern (DOCUMENTED RISK)

Column positions unchanged; only cell values in "Agent family" column differ. External parsers see same structure, different values. Documented in mission risks section.

**Impact:** Low — acceptable trade-off.

## Overall Assessment

The implementation is correct, minimal, and well-tested. Between rounds, the implementer added JSDoc annotations and improved type safety — both positive changes. All 6 success criteria are satisfied. All existing tests pass. No restricted areas were touched. The diff is safe to integrate.

---
`[workflow-round:2, workflow-phase:reviewing]`
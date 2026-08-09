# CP-2: Fix review-aggregate rounds filtering

## Summary
Fixed `deriveImplementerAndFixRounds` review-aggregate path to filter `rounds` by `round.implementer === reportedImplementer` before counting `changes-requested`. Aligns with branch-history path which already excludes previous implementer's rounds via `firstFinalImplementerRound`.

## Change
`src/adapters/cli/commands/stats.ts:1430` — added `round.implementer === implementer` to filter predicate.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Review rounds filtered to reported implementer | `src/adapters/cli/commands/stats.ts:1430`, `"task-2348: review-aggregate pr_fix_rounds counts only reported implementer rounds"` | PASS |
| Existing stats tests pass | `npm test -- test/stats.test.ts` — 62 pass, 0 fail | PASS |
| Test (b) greens | `"task-2348: review-aggregate pr_fix_rounds counts only reported implementer rounds"` | GREEN |
| Tests (a) and (c) still red | `"task-2348: mission with two implementers credits reported implementer not earlier one"`, `"task-2348: summarizeAgentWindow reads pr_fix_rounds from closed row not max across rows"` | RED (CP-3) |

Next action: CP-3 — fix `computeAgentMissionGroups` to use closed rollup row's `implementer` as identity for completed missions, and fix `summarizeAgentWindow` to read `pr_fix_rounds` from closed row. This greens tests (a) and (c).

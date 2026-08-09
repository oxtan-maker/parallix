# CP-3: Fix implementer identity and pr_fix_rounds source

## Summary
Fixed `computeAgentMissionGroups` to use closed rollup row's `implementer` as grouping authority for completed missions. Display key uses model only when it belongs to reported implementer's family (preserves task-2213 model display). Fixed `summarizeAgentWindow` to read `pr_fix_rounds` from closed row instead of max across all rows. Updated `task-1301` and `task-1314` test fixtures to match real data shape.

## Changes
- `src/adapters/cli/commands/stats.ts:912-918` — annotate row with `reportedImplementer` from closed row; display key uses `modelBelongsToImplFamily` check
- `src/adapters/cli/commands/stats.ts:976-985` — `storedRoundsByMission` reads from `closed: 'yes'` rows only
- `test/stats.test.ts:1418-1434` — task-1301 fixture: only final stage row `closed: 'yes'`
- `test/stats.test.ts:1436-1450` — task-1314 fixture: only final stage row `closed: 'yes'`

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Implementer identity from closed rollup row | `src/adapters/cli/commands/stats.ts:915`, `"task-2348: mission with two implementers credits reported implementer not earlier one"` | PASS |
| Display key preserves model for same-family missions | `src/adapters/cli/commands/stats.ts:928-935`, `"task-2213: summarizeAgentWindow keeps separate model rows for local AI missions"` | PASS |
| pr_fix_rounds from closed row | `src/adapters/cli/commands/stats.ts:976`, `"task-2348: summarizeAgentWindow reads pr_fix_rounds from closed row not max across rows"` | PASS |
| All 3 task-2348 tests green | `npm test -- test/task-2348-implementer-attribution.test.ts` — 3 pass | GREEN |
| Existing stats tests pass | `npm test -- test/stats.test.ts` — 62 pass, 0 fail | PASS |
| stats-report tests pass | `npm test -- test/stats-report.test.ts` — 10 pass, 0 fail | PASS |
| mission-phase-stats tests pass | `npm test -- test/mission-phase-stats.test.ts` — 11 pass, 0 fail | PASS |

Next action: CP-4 — run `./scripts/verify-local.sh all`, update `docs/` and `README.md` for agent-performance attribution, verify no stale descriptions of reviewer-as-implementer.

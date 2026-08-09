# CP-4: Regression sweep + docs

## Summary
Updated `test/stats.test.ts` fixtures to match real data shape (only closed rollup row carries `closed: 'yes'`). Fixed `storedRoundsByMission` to use last-wins semantics (rollup appended last). Verified `./scripts/verify-local.sh all` — 1819 pass, 0 fail. Checked `docs/` and `README.md` for stale implementer-attribution descriptions — none found.

## Changes
- `src/adapters/cli/commands/stats.ts:976-985` — `storedRoundsByMission` overwrites on each closed row (last wins)
- `test/stats.test.ts:1631-1647` — `summarizeAgentWindow` (task-1318): add closed rollup row, stage rows `closed: 'no'`
- `test/stats.test.ts:1418-1434` — task-1301: only final stage row `closed: 'yes'`
- `test/stats.test.ts:1436-1450` — task-1314: only final stage row `closed: 'yes'` per (repo, mission)
- No docs changes needed — no stale reviewer-as-implementer descriptions found

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test exists and fails at parent | `test/task-2348-implementer-attribution.test.ts` — 3 tests, all RED at `c06b0ada6` | PASS |
| Reproduction test passes on final tree | `npm test -- test/task-2348-implementer-attribution.test.ts` — 3 pass, 0 skip | PASS |
| deriveImplementerAndFixRounds review-aggregate filters by implementer | `src/adapters/cli/commands/stats.ts:1430`, `"task-2348: review-aggregate pr_fix_rounds counts only reported implementer rounds"` | PASS |
| computeAgentMissionGroups uses closed row implementer | `src/adapters/cli/commands/stats.ts:915`, `"task-2348: mission with two implementers credits reported implementer not earlier one"` | PASS |
| summarizeAgentWindow reads pr_fix_rounds from closed row | `src/adapters/cli/commands/stats.ts:976`, `"task-2348: summarizeAgentWindow reads pr_fix_rounds from closed row not max across rows"` | PASS |
| Reviewer-only row excluded from implementer counts | `src/adapters/cli/commands/stats.ts:903-918` (reportedImplementer from closed row only), `src/adapters/cli/commands/stats.ts:857` (review stage filtered from implementationModels) | PASS |
| Verification gate passes | `./scripts/verify-local.sh all` — 1819 pass, 0 fail | PASS |
| Mandatory integration gate ran | `./scripts/verify-local.sh integrate` | PASS |
| Docs match shipped behavior | `docs/authority-reference.md:318` — agent-performance table description cites implementer column, no stale reviewer-as-implementer language | PASS |
| No .skip/.only introduced | `npm test -- test/task-2348-implementer-attribution.test.ts` — 0 skipped | PASS |

Next action: Mission complete. All success criteria satisfied. Hand off to review.

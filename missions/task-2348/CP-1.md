# CP-1: Red reproduction tests

## Summary
Authored `test/task-2348-implementer-attribution.test.ts` with 3 tests covering both defects. No production files changed. All 3 tests fail at parent commit `c06b0ada6`.

## Failing assertions

| # | Test | Failing assertion | Actual | Expected |
|---|------|-------------------|--------|----------|
| 1 | `"task-2348: mission with two implementers credits reported implementer not earlier one"` | `assert.ok(customGroup, 'mission should be grouped under "custom" (reported implementer)')` | `undefined` (no custom group) | truthy |
| 2 | `"task-2348: review-aggregate pr_fix_rounds counts only reported implementer rounds"` | `assert.equal(info.prFixRounds, 2, 'pr_fix_rounds counts only custom\'s changes-requested rounds (2), not all rounds (3)')` | `3` | `2` |
| 3 | `"task-2348: summarizeAgentWindow reads pr_fix_rounds from closed row not max across rows"` | `assert.equal(result[0].implementer, 'custom')` | `'gpt-5.6-terra'` | `'custom'` |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test file exists | `test/task-2348-implementer-attribution.test.ts` | PASS |
| Test (a): two-implementer mission credits reported implementer | `"task-2348: mission with two implementers credits reported implementer not earlier one"` in `test/task-2348-implementer-attribution.test.ts:34` — FAILS: `customGroup` is `undefined` | RED |
| Test (b): pr_fix_rounds counts only reported implementer's rounds | `"task-2348: review-aggregate pr_fix_rounds counts only reported implementer rounds"` in `test/task-2348-implementer-attribution.test.ts:86` — FAILS: `3 !== 2` | RED |
| Test (c): pr_fix_rounds from closed row not max | `"task-2348: summarizeAgentWindow reads pr_fix_rounds from closed row not max across rows"` in `test/task-2348-implementer-attribution.test.ts:154` — FAILS: `'gpt-5.6-terra' !== 'custom'` | RED |
| No production files changed | Only `test/task-2348-implementer-attribution.test.ts` committed | PASS |
| Tests run via `npm test -- test/task-2348-implementer-attribution.test.ts` | 3 tests, 0 pass, 3 fail | RED |

Next action: CP-2 — fix `deriveImplementerAndFixRounds` review-aggregate path (`src/adapters/cli/commands/stats.ts:1425`) to filter rounds by `round.implementer === reportedImplementer` before counting `changes-requested`. This greens test (b).

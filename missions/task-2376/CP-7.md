# CP-7 — Review metric certification

## Summary

R10–R13 regression tests added in CP-6 cover all review metric certification requirements:

- R10: First-pass approval yields known `reviewFixRounds=0` (not unknown)
- R11: Two request-changes cycles yield known `reviewFixRounds=2`
- R12: External artifacts with misleading values do not affect authoritative result
- R13: Missing `MissionStore` returns `missing-authority` source — no heuristic inference activated

All 4 tests pass. Known zero distinct from unknown. TASK-2371 aggregation semantics preserved (unknown excluded from averages).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| First-pass approval = known zero | `test/task-2376-lifecycle-timing.test.ts` `"R10: first-pass approval yields known reviewFixRounds=0"` | PASS |
| Two fix rounds = known 2 | `test/task-2376-lifecycle-timing.test.ts` `"R11: two request-changes cycles yield known reviewFixRounds=2"` | PASS |
| External artifacts ignored | `test/task-2376-lifecycle-timing.test.ts` `"R12: external artifacts with misleading values do not affect authoritative result"` | PASS |
| Missing Review = unknown (not zero) | `test/task-2376-lifecycle-timing.test.ts` `"R13: missing MissionStore cannot activate heuristic inference"` | PASS |
| All 10 lifecycle tests pass | `npx tsx --test test/task-2376-lifecycle-timing.test.ts` — 10/10 | PASS |

Next action: CP-8 — lifecycle statistics proof.

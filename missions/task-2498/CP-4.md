# CP 4 — Final verification gate green

## Summary
Both defects fixed and committed:
- Defect 1: `web/src/flight-column.tsx` — working cards key the agent off the
  live agent (`working ? liveAgent : card.agent`), so a `null` live agent
  renders `no implementer` instead of the assignee; idle cards unchanged.
- Defect 2: `src/adapters/backlog/concrete-agent-read-adapter.ts` —
  `loadRunningSessions` attributes a running `px review` session whose
  reconciled current-work fact names a `null` agent to the mission assignee
  family.

Reproduction test `test/task-2498-review-null-agent-board.test.ts` went
red→green across the two fixes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: working null-agent card renders "no implementer", not assignee | `test/task-2498-review-null-agent-board.test.ts`, `"a working card with a null live agent renders "no implementer", never the assignee family"` | PASS |
| SC2: idle card still renders assignee family | `test/task-2498-review-null-agent-board.test.ts`, `"an idle card still renders its assignee family unchanged"` | PASS |
| SC3: null-agent review session attributes to assignee family | `test/task-2498-review-null-agent-board.test.ts`, `"a live null-agent review session attributes to the mission assignee family"` | PASS |
| SC4: per-family running count non-zero | `test/task-2498-review-null-agent-board.test.ts`, `test('a live null-agent review session attributes to the mission assignee family')` asserts `loadRunningSessions()` returns `[{ missionId, family: 'custom' }]` | PASS |
| SC5: non-null attribution + live outranks stale marker | `test/task-2393-current-work-attribution-repro.test.ts`; `test/running-sessions.test.ts` | PASS |
| SC6: verification gate green | `./scripts/verify-local.sh all` → EXIT 0, 2510 pass / 0 fail (lint, typecheck, test-hygiene, docs, build) | PASS |

## Next action
Mission complete. All four checkpoints committed; the sole gate (`./scripts/verify-local.sh all`) passes. No further work.

# CP 2 — Defect 1 fixed (flight-card agent pill)

## Summary
Fixed defect 1 in `web/src/flight-column.tsx`. The card previously computed
`const agent = liveAgent ?? card.agent`, so a `null` live agent (the
`null`-agent code-run bracket of a running review) fell back to the mission
assignee and rendered it as the live agent.

Change: key off whether the card is working. `const agent = working ? liveAgent : card.agent`.
While working, the live agent is authoritative even when `null` → the pill
renders `no implementer` (faint) and never the assignee. Idle cards (no live
agent) still fall back to `card.agent`, so the assignee display is unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: working null-agent card renders "no implementer", not assignee | test `"a working card with a null live agent renders "no implementer", never the assignee family"` | PASS |
| SC2: idle card still renders assignee family | test `"an idle card still renders its assignee family unchanged"` | PASS |
| Existing web board render suite green | `test/web-board-render.test.ts` (44 pass / 1 fail; the single failure is the not-yet-fixed defect 2 adapter test) | PASS |
| SC5 non-null attribution still holds | test `"a live non-null agent session still attributes to that agent (SC5)"` | PASS |

## Next action
CP 3: fix defect 2 in `src/adapters/backlog/concrete-agent-read-adapter.ts` (`loadRunningSessions` attributes the null-agent review session to the assignee family) and run the reproduction test plus `test/running-sessions.test.ts` and `test/task-2393-current-work-attribution-repro.test.ts`.

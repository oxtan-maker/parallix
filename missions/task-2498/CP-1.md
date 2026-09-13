# CP 1 — Failing reproduction test (red)

## Summary
Author `test/task-2498-review-null-agent-board.test.ts`, which locks both
defects from the operator-DB fact sequence (a live `px review --continue`
reconciled current-work fact naming a `null` agent, mission assignee `custom`):

- **Defect 1 (SC1/SC2):** a working card with `agent: null` and assignee `custom`
  must render the agent pill as `no implementer` and never render `custom`; an
  idle card with assignee `custom` still renders `custom`.
- **Defect 2 (SC3/SC4/SC5):** `ConcreteAgentReadAdapter.loadRunningSessions`
  must attribute the live null-agent review session to the `custom` family; a
  live non-null (`claude`) session still attributes to `claude`.

Run with:
```
npx tsx --test test/task-2498-review-null-agent-board.test.ts
```

Red proof at parent (both reproduction assertions fail):
- `a working card with a null live agent renders "no implementer", never the assignee family` → actual pill text `custom`, expected `/no implementer/`.
- `a live null-agent review session attributes to the mission assignee family` → actual `[{ missionId: 'task-2498', family: null }]`, expected `[{ missionId: 'task-2498', family: 'custom' }]`.

Both failures are the parent behavior; the test is green once both fixes land.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test exists and goes red at parent | `test/task-2498-review-null-agent-board.test.ts` | PASS |
| Defect 1 reproduces (card shows assignee, not "no implementer") | test `"a working card with a null live agent renders "no implementer", never the assignee family"` fails | PASS |
| Defect 2 reproduces (session unattributed) | test `"a live null-agent review session attributes to the mission assignee family"` fails | PASS |
| SC5 baseline still holds at parent (non-null attributes) | test `"a live non-null agent session still attributes to that agent (SC5)"` passes | PASS |

## Next action
CP 2: fix defect 1 in `web/src/flight-column.tsx` and run the reproduction test plus `test/web-board-render.test.ts`.

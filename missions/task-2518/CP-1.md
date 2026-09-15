# CP-1 — Lock the bug

## Summary

Authored `test/task-2518-board-action-vocabulary-repro.test.ts` before touching
production code. The test composes a hermetic board projection (in-memory
`MissionStore` double, no current-work events, no failed gate, pattern copied
from `test/attention-orphaned-active-observable.test.ts`) holding one mission
in status `active`, converts it with `toWebBoardSnapshot`, round-trips it
through `JSON.parse(JSON.stringify(...))`, and calls
`validateWebBoardSnapshot`. It asserts the validation is ok, that the
`orphaned-active` attention item's action is
`{ kind: 'active:execute', display: 'px active task-stranded' }`, that the
card's `active` command is `enabled: true` with `targetLane: 'active'`, that
the wire attention action state is `enabled`, and that no card or attention
action carries `recover:mission`.

Red run recorded at the mission's parent commit `6e3f30cdefeedcdafb885661e6fa1445a0bc20f0`
(no production code changed yet):

Command: `npm test -- test/task-2518-board-action-vocabulary-repro.test.ts`

Failing assertion (first problem of three):

```
snapshot.stages[2].cards[0].actions[0].kind must be one of active:execute, mission:intake, draft:create, checkpoint:record, handoff:record, review:submit, review:act-on-findings, approve:review, integrate:merge, mission:cancel, got recover:mission
```

The same rejection repeats for `snapshot.attentionQueue[0].action.kind` and
`snapshot.availableActions[0].kind`, which is exactly the fail-closed snapshot
described in the mission: the producer emits a kind `COMMAND_KINDS` never
accepted. The stop rule "repro passes at the parent commit" does not apply.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3 red at parent commit: stranded snapshot rejected because of `recover:mission` | `npm test -- test/task-2518-board-action-vocabulary-repro.test.ts` at parent `6e3f30cdefeedcdafb885661e6fa1445a0bc20f0`, test `"stranded active mission snapshot validates and advertises active:execute"` in `test/task-2518-board-action-vocabulary-repro.test.ts` | RED (expected) |
| SC2 replacement action asserted before the fix exists | test `"stranded active mission snapshot validates and advertises active:execute"` asserts `{ kind: 'active:execute', display: 'px active task-stranded' }` and `targetLane: 'active'` (`test/task-2518-board-action-vocabulary-repro.test.ts`) | RED (expected) |
| SC7 no focused or skipped markers introduced | `git grep -n "test.only\|\.skip\|todo" -- test/task-2518-board-action-vocabulary-repro.test.ts` returns no matches | PASS |

Next action: CP 2 — remove `recover:mission` / board `'recover'` from `src/application/projections/board.ts`, `src/application/projections/mission-board.ts`, `src/application/controller/board-command.ts`, `src/interfaces/web/transport.ts`, and update `test/attention-orphaned-active-observable.test.ts`, `test/board-readers.test.ts`, `test/board-controller.test.ts`.

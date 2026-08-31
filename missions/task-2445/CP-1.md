# CP-1: Lock the bug red

## Summary

Authored the focused reproduction test
`test/task-2445-prevent-direct-backlog-activation.test.ts` covering all five
cases declared in the mission's CP-1 scope:

- (a) `decideMission` on an open `backlog` mission with
  `{ type: 'activate', agent }` must throw `MissionRuleViolation` — **red at
  the parent commit**.
- (b) `decideMission` on an open `refined` mission with the same command
  returns status `active` and records the agent as assignee — green.
- (c) `availableBoardCommands` for `backlog`: `draft` enabled, `active`
  disabled with reason `Mission must be refined before it can be activated`;
  for `refined`: `active` enabled, `draft` disabled — green (task-2434 already
  fixed the projection half).
- (d) `triggerFromTransition('backlog', 'active')` must return `null` — **red
  at the parent commit**.
- (e) `triggerFromTransition('refined', 'active')` and
  `triggerFromTransition(null, 'active')` both return `'activate'` — green.

No source file was modified in this checkpoint. The mission fixture is built
locally in the test file (no shared fixture edits).

### Recorded red state at the parent commit

`npm test -- test/task-2445-prevent-direct-backlog-activation.test.ts`
reported `tests 5 / pass 3 / fail 2`, with exactly assertions (a) and (d)
failing:

```
✖ activate rejects an open backlog mission
  AssertionError [ERR_ASSERTION]: Missing expected exception (MissionRuleViolation).
      at TestContext.<anonymous> (test/task-2445-prevent-direct-backlog-activation.test.ts:32:10)
    operator: 'throws'

✖ a backlog to active lane move is not a recognised activation trigger
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  'activate' !== null
      at TestContext.<anonymous> (test/task-2445-prevent-direct-backlog-activation.test.ts:59:10)
    actual: 'activate', expected: null
```

The pre-existing red assertion left by task-2434 has the same root cause.
`npm test -- test/domain-mission.test.ts` reported `tests 17 / pass 16 /
fail 1`:

```
✖ mission lifecycle rejects unsupported jumps and missing handoff evidence
  AssertionError [ERR_ASSERTION]: Missing expected exception (MissionRuleViolation).
      at TestContext.<anonymous> (test/domain-mission.test.ts:129:10)
```

Both failures are attributable to the locked bug: `decideMission`'s
`case 'activate'` in `src/domain/mission-workflow.ts` still lists `'backlog'`
in its allow-list, and `triggerFromTransition` in `src/domain/board-event.ts`
still maps `from === 'backlog'` to `'activate'`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 (red half): activate must reject an open backlog mission | `test/task-2445-prevent-direct-backlog-activation.test.ts`, `"activate rejects an open backlog mission"` — fails at parent with `Missing expected exception (MissionRuleViolation)`; `test/domain-mission.test.ts`, `"mission lifecycle rejects unsupported jumps and missing handoff evidence"` red for the same cause | RED (expected) |
| SC1 (green half): activate accepts a refined mission and records the assignee | `test/task-2445-prevent-direct-backlog-activation.test.ts`, `"activate accepts a refined mission and records the agent as assignee"` passes at parent | PASS |
| SC2: projection invariants re-locked without touching the projection source | `test/task-2445-prevent-direct-backlog-activation.test.ts`, `"board projection offers draft for backlog and active for refined"` passes at parent; existing `test/domain-projections.test.ts`, `"backlog missions must be drafted before activation"` unchanged | PASS |
| SC3 (red half): `triggerFromTransition('backlog', 'active')` must be `null` | `test/task-2445-prevent-direct-backlog-activation.test.ts`, `"a backlog to active lane move is not a recognised activation trigger"` — fails at parent with `'activate' !== null` | RED (expected) |
| SC3 (green half): refined and intake activation triggers preserved | `test/task-2445-prevent-direct-backlog-activation.test.ts`, `"refined and intake lane moves to active stay activation triggers"` passes at parent | PASS |
| No source changed in CP-1 | Only `test/task-2445-prevent-direct-backlog-activation.test.ts` and `missions/task-2445/CP-1.md` are added; `src/domain/mission-workflow.ts` and `src/domain/board-event.ts` untouched at this checkpoint | PASS |
| Red state attributable to the locked bug only | `npm test -- test/task-2445-prevent-direct-backlog-activation.test.ts` (3 pass / 2 fail) and `npm test -- test/domain-mission.test.ts` (16 pass / 1 fail) — failures limited to the two assertions above | PASS |

Next action: in `src/domain/mission-workflow.ts`, remove `'backlog'` from the
`requireStatus(mission, ['backlog', 'refined', 'active'], command)` allow-list
in `decideMission`'s `case 'activate'`, then remove `from === 'backlog'` from
the `to === 'active'` branch of `triggerFromTransition` in
`src/domain/board-event.ts` and correct its doc-comment mapping to
`refined/active → active : 'activate'`.

# CP-3: Verification gate and final Goal Check

## Goal
Make active-work status truthful and visible (task-2399).

## Work done
Ran the mission's required gate on the final tree and recorded durable evidence.
All three checkpoints' changes are committed:
- `d9c093e2e` — failing assertions for the new output contract (CP-1)
- `98a1663e7` — drop `working` label / `● WORKING` stamp, add active-only blink
  (CP-2)

Review round 1 (REQUEST_CHANGES) resolved:
- `1286a192d` — revert the unrelated spawn-tee liveness timing change from the
  mission branch (moved to side branch `spawn-tee-liveness-fix`); it was outside
  the locked mission-activity/board scope.
- selected active/running cards now receive the blink: the focused (▶) glyph is
  wrapped in the ANSI blink when `agentIsWorking(card)`, and
  `test/mission-activity.test.ts`, `a selected active card still carries the
  activity treatment`, covers the focused-card path.

Review round 4 (claude, REQUEST_CHANGES) resolved:
- `e1c639db8` — revert the out-of-scope `fixes` commit `fd0aa3647`, which had
  deleted the state-derived agent block reason from `src/interfaces/tui/agent-strip.tsx`,
  removed the `WorkingItems` rail component + active-mission count from
  `src/interfaces/tui/shell.tsx`, and rewrote `test/task-2373-operator-rail.test.ts`
  SC15/SC16 to assert those grounded signals were absent. The revert restores the
  rail count, the recovery-evidence rail rows, the agent block reason, and the
  original SC15/SC16 names. The locked `MISSION.md` (F3) was likewise restored to
  its locked text by this revert; `MISSION.md` was not otherwise changed by this
  mission. F5 (stale `[reason]` doc comment) is auto-resolved: the reason render
  is restored so the `[reason]` annotation in the block comments is accurate again.
- `test/task-2373-operator-rail.test.ts` SC15/SC16 now assert the grounded rail
  count and recovery evidence survive; the goal-check rows below cite the exact
  restored test names.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Active-agent count retained, fabricated trailing text removed | `test/mission-activity.test.ts`, `describeMissionWork drops the unrequested working label and keeps only the trust grade and phase`; `summarizeMissionActivity`/`describeMissionActivityTotals` `work: 1 live` | PASS |
| Literal "Working" text absent from active render | `test/mission-activity.test.ts`, `px status omits the working label from the active mission work line`; `test/task-2373-operator-rail.test.ts`, `SC15: WORKING count either renders every live mission or states the hidden overflow` | PASS |
| Active/running card animated; others not | `test/mission-activity.test.ts`, `an active mission card receives a terminal-compatible activity treatment and an idle card does not`; `a selected active card still carries the activity treatment` | PASS |
| Working count still shown in the rail | `test/task-2373-operator-rail.test.ts`, `SC16: bounded recovery evidence remains visibly WORKING with an uncertainty label`; `test/tui-wave-4-attention.test.ts`, `working work is separate from NEEDS YOU` | PASS |
| `./scripts/verify-local.sh all` passes | full suite: 2067 tests, 0 fail; EXIT=0 | PASS |

## Next action
All checkpoints committed and the `./scripts/verify-local.sh all` gate passes, so task-2399 execution is complete; hand off to review via Parallix lifecycle.

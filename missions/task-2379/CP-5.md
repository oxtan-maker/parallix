# CP 5 — Domain hardening (Part G)

## Summary

Confirmed the `integrate` domain command already requires
`Mission.status = integration` only, so direct `review → done` is impossible
at the domain level. No code change was needed — the invariant was in place
in the baseline (`requireStatus(mission, ['integration'], command)` in
`src/domain/mission-workflow.ts`, `case 'integrate'`).

`decideMission` on a Mission with `status = review` and `command =
{ type: 'integrate' }` throws `MissionRuleViolation`
("Cannot integrate while … is review; expected integration"). The only way
into `done` is `integration → done`, and the only way into `integration` is
the `approve` transition on an approved Review aggregate (proven in CP 2).
This is what makes the CP 3/CP 4 recovery honest: `px integrate` repairs the
missing intermediate states (`review → integration` via `approve`) instead of
letting integration silently hide a stale/missing approval transition.

The R4–R9 recovery regressions were re-run against the committed tree and all
pass:

- R4 stale `active` + Review facts → `submit-for-review` then `approve` @ `decidedAt`
- R5 stale `active` + human override → real `ReviewerDecision` then existing chain
- R6 stale `active` without facts/override → abort, not done
- R7 `review` unapproved, no override → stops, remains `review`
- R8 domain `integrate` from `review` → `MissionRuleViolation`
- R9 `integration` passthrough, no duplicate approval

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `integrate` command requires `status = integration` only (SC8, AC16) | `decideMission` `case 'integrate'` in `src/domain/mission-workflow.ts` (`requireStatus(mission, ['integration'], command)`); `test/task-2376-lifecycle-timing.test.ts` "R8: direct review → done forbidden — integrate requires integration status" | PASS |
| Direct `review → done` is a `MissionRuleViolation` (SC8) | `test/task-2376-lifecycle-timing.test.ts` "R8 sensitivity: review → done shortcut skips integration lane"; `decideMission` in `src/domain/mission-workflow.ts` | PASS |
| Only completion path is `integration → done` (AC17/AC18) | `persistLandedIntegrationOrAbort` in `src/adapters/cli/commands/integrate-post.ts`; `test/integrate.test.ts` "persistLandedIntegrationOrAbort records lifecycle completion and closure" | PASS |
| R4–R9 recovery regressions re-run green on committed tree | `node --experimental-test-module-mocks --import tsx --test test/integrate.test.ts` → 75/75; `test/task-2376-lifecycle-timing.test.ts` → 11/11 | PASS |
| No domain rule change required / no permissive shortcut introduced (SC17) | `src/domain/mission-workflow.ts` unchanged in this checkpoint; `git diff` shows no domain edit | PASS |

Next action: CP 6 — delete obsolete inference (Parts H/I/J): make the MissionStore a required parameter of `deriveImplementerAndFixRounds`/`createStatsWorkflowAdapter` (drop the `null` adapter form), fix every caller that omitted the store, and confirm no orphaned imports/tests remain.

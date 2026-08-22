# CP-3: Verify active-lane materialization

Ran the focused regression and the required repository gate after preserving
completed/archive task discovery while selecting the authoritative base record.
The board read now uses the base lifecycle state only when it is invoked from
the mission worktree; existing primary-worktree reads keep their discovered
task file.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: authoritative active lifecycle survives a differing worktree record | `test/task-2392-active-lane-repro.test.ts`, `"task-2392: active task appears in active stage, not backlog"` | PASS |
| SC2: the card appears once in ACTIVE and never in BACKLOG | `npx tsx --test test/task-2392-active-lane-repro.test.ts` | PASS |
| SC3: stage membership continues to derive from `MissionCard.lane` | `test/task-2392-active-lane-repro.test.ts`, `"task-2392: active task appears in active stage, not backlog"` | PASS |
| SC4: the captured mission-worktree scenario is red without the base-record selection and green with it | `test/task-2392-active-lane-repro.test.ts` | PASS |
| SC5: repository and integration verification pass on the final tree | `./scripts/verify-local.sh all`, `./scripts/verify-local.sh integrate` | PASS |

Next action: All declared checkpoints and the required verification gate are complete; retain the committed change for Parallix-managed review.

# CP-1 — Red reproduction of the duplicate lane-event handoff failure

## Summary

Authored the red-to-green reproduction declared by the mission's
`Reproduction-Test:` line, before any production change:
`test/task-2456-handoff-retry-duplicate-lane-event.test.ts`.

The test drives `MissionLifecycleService` directly against a temp SQLite store
(`SqliteMissionStore` over `SqliteDatabaseAdapter` with the default migrations)
— no Forgejo, no CLI subprocess, no agent launch — matching the pattern used by
`test/task-2379-approval-boundary-repro.test.ts`.

Fixture timeline for mission `task-2456-retry`:

| Time | Step |
|---|---|
| 10:00 | handoff 1 commits `active -> review` with the stable key `handoff-<slug>` |
| 11:00 | reviewer requests changes: `review -> active` |
| 12:00 | implementer resolves the finding and opens review round 2 |
| 13:00 | handoff 2 replays `active -> review` under the **same** `handoff-<slug>` key |

Two cases:

- **R1 (SC1)** `"a retried handoff replays its already recorded active -> review lane event instead of conflicting"` —
  asserts the retried transition returns `completed` with `to === 'review'`,
  the persisted version, a persisted mission status of `review`, and exactly
  one lane event under `handoff-<slug>`. **RED** at the current tree: it fails
  with `Duplicate idempotency key: handoff-task-2456-retry`.
- **R2 (SC2)** `"a duplicate handoff key on a distinct approve transition stays a conflict"` —
  reuses `handoff-<slug>` for a genuinely distinct `review -> integration`
  (`approve`) transition and asserts it still returns `status === 'failed'`
  with `error.kind === 'conflict'` and leaves the mission untouched. **GREEN**
  at the current tree; it is the regression fence that CP-2 must not break.

Root cause located for CP-2: `src/application/mission-lifecycle-service.ts`
`transition()` maps every `Duplicate idempotency key` refusal to
`failure('conflict', …)`. `src/application/mission-integration-service.ts`
`decideIntegration()`/`close()` do the same through `isDuplicateLaneEvent`
(`src/application/lifecycle-lane-event.ts`). Because
`SqliteMissionStore.saveAggregateWithTransition` rolls the whole transaction
back on the duplicate, the aggregate write is discarded along with the
already-recorded event, so the caller sees a conflict for a transition whose
history entry is already durable.

The parent-commit assumption in the mission (`22c4ec55d`) is confirmed an
ancestor of the working head: `git merge-base --is-ancestor 22c4ec55d HEAD`
exits 0. The commits between are `backlog(task-2456)` lifecycle transitions
only, which touch no source under `src/`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 reproduction exists and is red before the fix | `npm test -- test/task-2456-handoff-retry-duplicate-lane-event.test.ts` fails `"a retried handoff replays its already recorded active -> review lane event instead of conflicting"` with `Duplicate idempotency key: handoff-task-2456-retry` | PASS (red as intended) |
| SC2 non-idempotent duplicate stays a conflict (fence in place) | `"a duplicate handoff key on a distinct approve transition stays a conflict"` in `test/task-2456-handoff-retry-duplicate-lane-event.test.ts` passes | PASS |
| SC3 test lives at the mission's declared `Reproduction-Test:` path | `test/task-2456-handoff-retry-duplicate-lane-event.test.ts` | PASS |
| Reproduction is deterministic and store-only (no Forgejo/CLI/agent) | `test/task-2456-handoff-retry-duplicate-lane-event.test.ts` uses `SqliteMissionStore` + `SqliteMigrationRunner` only, per the pattern in `test/task-2379-approval-boundary-repro.test.ts` | PASS |
| SC6 no `.only` and no bare `.skip` introduced | `grep -n "\.only\|\.skip" test/task-2456-handoff-retry-duplicate-lane-event.test.ts` returns nothing | PASS |
| Parent-commit assumption verified | `git merge-base --is-ancestor 22c4ec55d HEAD` | PASS |
| Defect site identified for CP-2 | `src/application/mission-lifecycle-service.ts` `transition()` duplicate-key catch; `src/application/mission-integration-service.ts` `decideIntegration()`/`close()` via `isDuplicateLaneEvent` in `src/application/lifecycle-lane-event.ts` | PASS |

Next action: CP-2 — add a replay discriminator that matches the already
recorded lane event by idempotency key plus `from`/`to`/`trigger`, wire it into
`MissionLifecycleService.transition` and `MissionIntegrationService.decideIntegration`/`close`
so a matched replay persists the aggregate through `save()` and returns
`completed`, and confirm R1 turns green while R2 stays a conflict.

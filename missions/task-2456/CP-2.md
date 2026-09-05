# CP-2 — Idempotent-replay treatment for a duplicate lane event

## Summary

Turned the CP-1 red case green without weakening the conflict path.

**The discriminator.** Added `isReplayedLaneEvent(store, event)` to
`src/application/lifecycle-lane-event.ts`, beside the existing
`isDuplicateLaneEvent`. It answers the question the mission's risk section
demands be answered from persisted state rather than from the incoming command:
a `Duplicate idempotency key` refusal is a **replay** only when the lane event
already recorded under that exact key describes this same transition — same
mission, same `from`, same `to`, same `trigger`. It reads that through the
already-existing optional `MissionTransitionStore.findTransitions` port method
(no new port). A store that keeps no lane history, or a key whose recorded
event describes a different transition, is **not** a replay and stays a
conflict.

To let the helper compare lane pairs, `MissionTransitionHistoryEntry` in
`src/application/domain-ports.ts` was widened with the optional
`fromStatus`/`toStatus`/`idempotencyKey` fields that
`SqliteMissionStore.findTransitions` already returns from
`SqliteBoardLaneEventRepository.findByMissionId`. The fields are optional, so
existing in-memory test doubles that return `[]` or `{ trigger }` still satisfy
the port.

**The repair.** `SqliteMissionStore.saveAggregateWithTransition` rolls its whole
transaction back on the duplicate, so the aggregate write is discarded along
with an event that is already durable. On a confirmed replay both services now
redo the aggregate write alone via `save(decided, expectedVersion)` and return
`completed`, instead of reporting a conflict for work the history already
records:

- `src/application/mission-lifecycle-service.ts` — `transition()`; the result
  carries `laneChanged: false`, since this call added no history entry.
- `src/application/mission-integration-service.ts` — `decideIntegration()` and
  `close()`, through one shared private `duplicateOutcome` helper so every
  `saveWithTransition` caller honours the stable-key intent identically.

Everything else keeps its previous outcome: a non-duplicate write error still
goes through `writeFailure` (so the `MissionStaleVersion` / stale-write path
stays a `conflict`), and a non-replay duplicate still returns
`failure('conflict', …)`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 retried `submit-for-review` under the stable key returns `completed` with `to === 'review'` and the persisted version | `"a retried handoff replays its already recorded active -> review lane event instead of conflicting"` passes via `npm test -- test/task-2456-handoff-retry-duplicate-lane-event.test.ts` (2 tests, 0 fail) | PASS |
| SC2 a duplicate key on a genuinely distinct transition stays a `conflict` | `"a duplicate handoff key on a distinct approve transition stays a conflict"` in `test/task-2456-handoff-retry-duplicate-lane-event.test.ts` passes | PASS |
| SC3 the reproduction flipped red-to-green | Red recorded in `missions/task-2456/CP-1.md` (`Duplicate idempotency key: handoff-task-2456-retry`); green now under `npm test -- test/task-2456-handoff-retry-duplicate-lane-event.test.ts` | PASS |
| Replay decided from persisted state, not from the command | `isReplayedLaneEvent` in `src/application/lifecycle-lane-event.ts` matches the recorded event on `idempotencyKey` + `trigger` + `fromStatus` + `toStatus` via `MissionTransitionStore.findTransitions` | PASS |
| Stale-write / `MissionStaleVersion` path still a conflict | `src/application/mission-lifecycle-service.ts` routes every non-duplicate error to `writeFailure`, whose `isStaleWrite` branch returns `failure('conflict', …)` in `src/application/mission-command-support.ts` | PASS |
| All `saveWithTransition` callers treated identically | `MissionIntegrationService.duplicateOutcome` in `src/application/mission-integration-service.ts` serves both `decideIntegration()` and `close()` | PASS |
| Scope respected: no domain rules, no key shape, no migrations | `src/domain/mission-workflow.ts`, the `handoff-${slug}` site in `src/application/handoff-command-use-case.ts`, `laneEventIdempotencyKey` in `src/application/lifecycle-lane-event.ts` and `migrations/` are unchanged — `git show --stat 9ffbc2ad3` lists only the four application files above, the reproduction test, and `missions/task-2456/CP-2.md` | PASS |
| SC5 ESLint, `tsc --checkJs`, and test-hygiene clean on every changed file | `./scripts/verify-local.sh static-analysis` — "ALL STAGES PASSED" (ESLint clean, tsc typecheck clean, test-hygiene clean, test typecheck clean) | PASS |
| SC6 no `.only` and no bare `.skip` | `grep -rn "\.only\|\.skip" test/task-2456-handoff-retry-duplicate-lane-event.test.ts` returns nothing | PASS |

Next action: CP-3 — run the mission's single declared gate
`./scripts/verify-local.sh all` on the committed tree and record its result in
the final checkpoint's Goal Check table alongside SC1–SC7.

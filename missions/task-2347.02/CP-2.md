# CP-2 — Intake, integration and closure take the transition-aware path

## Summary

All three lifecycle steps now commit their aggregate write and their lane event
as one unit through `saveWithTransition`:

- **Port widened (minimally).** `MissionTransitionStore.saveWithTransition` now
  accepts `MissionVersion | null` for `expectedVersion`, matching the `save()`
  insert contract, so intake can insert the aggregate *and* its entry event in
  one transaction (`src/application/domain-ports.ts:47`). The SQLite adapter
  signature follows; `persistAggregate` already handled the null (insert) case,
  so no SQL changed (`src/adapters/sqlite/mission-store.ts:107`).
- **Shared event builder.** New `src/application/lifecycle-lane-event.ts` holds
  the deterministic idempotency key (`missionId:trigger:occurredAt`, the shape
  `MissionLifecycleService` already uses), the event builder, and the single
  documented widening that lets the two triggers outside the state machine —
  `intake` and `close` — be recorded without touching `LaneTransitionEvent`,
  `triggerFromTransition`, `decideMission` or the `board_lane_events` schema
  (all mission-restricted).
- **Intake** emits `from: null → to: backlog` with trigger `intake`
  (`src/application/mission-intake-service.ts:92`), with `occurredAt` and
  `idempotencyKey` accepted on the request and defaulting to now.
- **`integration → done`** emits trigger `integrate`
  (`src/application/mission-integration-service.ts:65`).
- **Closure** emits trigger `close` at `closedAt` — a distinct event from
  `integrate`, so the final lane dwell is bounded
  (`src/application/mission-integration-service.ts:97`).
- A duplicate idempotency key surfaces as a `conflict` outcome instead of an
  execution failure, matching `MissionLifecycleService.transition`.

Three existing tests encoded the old contract (intake writes no lane event) and
were updated to the new one, plus the `MissionIntegrationService` unit fake
gained `saveWithTransition` and now asserts the emitted events.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — intake writes `to_status='backlog'`, `from_status=null` | `src/application/mission-intake-service.ts:92`, `"intake produces a backlog-entry lane event"` | PASS |
| SC2 — `decideIntegration` writes `integration → done` | `src/application/mission-integration-service.ts:65`, `"decideIntegration produces an integration-to-done lane event"` | PASS |
| SC3 — `close` writes a closure event | `src/application/mission-integration-service.ts:97`, `"close produces a closure lane event"` | PASS |
| Reproduction is green after the fix (DoD #6) | `npx tsx --test test/task-2347.02-repro.test.ts` reports `tests 3 / pass 3 / fail 0` (red at CP-1) | PASS |
| Port widening kept minimal (stop rule) | `src/application/domain-ports.ts:47` — only `expectedVersion` became nullable; no new port, no hierarchy change | PASS |
| Restricted files untouched | `src/domain/mission-workflow.ts`, `src/domain/board-event.ts`, `src/adapters/sqlite/board-lane-event-repository.ts` and `src/domain/mission.ts` carry no change in this checkpoint; the two extra triggers are widened once in `src/application/lifecycle-lane-event.ts:36` instead | PASS |
| Deterministic key shape shared with the lifecycle path | `src/application/lifecycle-lane-event.ts:48`, `src/application/mission-lifecycle-service.ts:142` | PASS |
| Existing contract tests updated, not deleted | `"SC1/SC6: intake writes one Mission aggregate and its external trace, and no task catalog"`, `"SC2: activation commits the lifecycle change and its lane event in one transaction"`, `"accepts explicit fresh merge and verification facts before integration persistence"` | PASS |
| Typecheck clean on the changed tree (DoD #2) | `npm run typecheck` exits 0 | PASS |
| Default suite green | `npm test` reports `tests 1820 / pass 1820 / fail 0` | PASS |

Next action: CP-3 — replace the wall-clock idempotency key in
`src/adapters/backlog/backlog.ts` with `missionId:trigger:occurredAt`, delegate
that recording block to `SqliteMissionStore.saveWithTransition`, and rewrite
`test/board-event-guardrail.test.ts` so the designated writer is the store
(SC5, SC6).

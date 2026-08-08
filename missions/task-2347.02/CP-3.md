# CP-3 — One writer, one deterministic key

## Summary

The competing write path in the Markdown transition seam is gone and the
wall-clock key with it.

- **`transitionTaskOnIntegrationBranch` delegates.** It no longer builds a
  `LaneTransitionEvent`, constructs a `BoardEventRecorder` or touches
  `SqliteBoardLaneEventRepository`. It loads the Mission aggregate, mirrors the
  authoritative Markdown status onto it and calls
  `SqliteMissionStore.saveWithTransition`, which appends the lane event
  (`src/adapters/backlog/backlog.ts:848`). The operation-log entry still commits
  inside the same outer transaction — `SqliteDatabaseAdapter.beginTransaction`
  is depth-counted, so the store's inner transaction joins this one
  (`src/adapters/sqlite/database-adapter.ts:260`) — and a failure rolls the whole
  unit back. Unknown slug or a closed mission records nothing rather than
  inventing a bare event.
- **Deterministic key.** The retired key was
  `${slug}-${from}-${to}-${Date.now() / 1000 | 0}`: two transitions inside one
  second collided and were dropped, while a replay one second later duplicated.
  The key is now the transition identity `missionId:trigger:occurredAt`, built
  once in `src/application/lifecycle-lane-event.ts:48` and shared with
  `MissionLifecycleService`.
- **Guardrail rewritten** to the new contract: the designated writer is
  `src/adapters/sqlite/mission-store.ts`, the Markdown seam is asserted to
  delegate, the append is asserted to be a single call site inside
  `saveAggregateWithTransition`, and a new test fails on any `idempotencyKey`
  derived from `Date.now()`.

The guardrail was verified to bite: a probe file under `src/adapters/sqlite/`
containing `board_lane_events` and a `Date.now()`-derived `idempotencyKey` turned
both `"SC5: only SqliteMissionStore appends lane events"` and `"SC6: no
lane-event idempotency key is derived from the wall clock"` red; removing the
probe restored green.

`test/backlog.test.ts` reports 64 pass / 1 fail both with and without this
change (unawaited `transitionTask` promises in pre-existing tests) — the same
result on the stashed tree, so it is baseline, not a regression. That file is
not part of the default suite.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC5 — exactly one code path writes lane events | `src/adapters/sqlite/mission-store.ts:246`, `"SC5: only SqliteMissionStore appends lane events"`, `"SC5: the designated writer appends the event inside saveWithTransition"` | PASS |
| SC5 — guardrail fails on a second writer | Probe file containing `board_lane_events` under `src/adapters/sqlite/` made `test/board-event-guardrail.test.ts` report `pass 3 / fail 2` | PASS |
| Markdown seam retired as a writer | `src/adapters/backlog/backlog.ts:848`, `"SC5: the Markdown transition seam delegates instead of writing its own event"` | PASS |
| SC6 — replay appends exactly one row | `"replaying one transition appends one row while distinct transitions never collide"`, `test/task-2347.02-repro.test.ts` | PASS |
| SC6 — same mission + trigger, different `occurredAt` do not collide | Same test asserts keys `…:activate:2026-08-08T01:00:00.100Z` and `…:activate:2026-08-08T01:00:00.900Z` both present (800ms apart, one epoch second) | PASS |
| Wall-clock key removed everywhere | `src/application/lifecycle-lane-event.ts:48`, `"SC6: no lane-event idempotency key is derived from the wall clock"` | PASS |
| Lane event and operation log still commit as one unit | `src/adapters/backlog/backlog.ts:846`, `src/adapters/sqlite/database-adapter.ts:260` | PASS |
| Typecheck clean (DoD #2) | `npm run typecheck` exits 0 | PASS |
| Default suite green | `npm test` reports `tests 1820 / pass 1820 / fail 0` | PASS |
| `test/backlog.test.ts` unchanged from baseline | 64 pass / 1 fail on both the stashed parent tree and this tree | PASS |

Next action: CP-4 — add the full-lifecycle test that drives one mission from
intake through `closed` and asserts a gap-free ordered lane history (SC4), then
run `./scripts/verify-local.sh all` as the mission gate.

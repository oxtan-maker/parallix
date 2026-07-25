# CP-2: Recording service

## Summary of work done

Implemented the `BoardEventRecorder` service with an `append()` method that
writes lane-transition events to `operational_history` using the existing
`append()` API. Added the `recordLaneTransitionSafely` wrapper ensuring
recording failure never blocks the authoritative transition (ADR 0051).

- **`src/application/recording/board-event-recorder.ts`** — `BoardEventRecorder`
  class with `append()` method implementing application-level dedup by
  operationId (scans existing entries before writing). The storage-layer
  partial UNIQUE index (migration 0003) provides a durable backstop.
  `recordLaneTransitionSafely()` catches all exceptions and returns `false`
  instead of throwing. `laneTransitionToHistoryEntry()` maps the typed event
  to `operational_history` format. `parseLaneTransitionEvent()` round-trips
  stored entries back to `LaneTransitionEvent`. `laneTransitionEventToMissionTransition()`
  converts events to the `MissionTransition` shape consumed by `buildMetrics`.
- **`test/board-event-recorder.test.ts`** — tests for mapping round-trip,
  persistence through `append()`, idempotency (SC5 — same operationId produces
  exactly one row), distinct operationIds, safe recording (SC4 — throws are
  swallowed), and successful write propagation.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4: recording failure never blocks the authoritative transition | `src/application/recording/board-event-recorder.ts:57` — `recordLaneTransitionSafely` catches and returns `false`; test `"swallows a recorder failure and returns false instead of throwing"` in `test/board-event-recorder.test.ts` | PASS |
| SC5: duplicate emissions do not produce duplicate rows | `src/application/recording/board-event-recorder.ts:38` — application-level dedup by operationId; test `"SC5: emitting the same operation id twice does not produce a duplicate row"` in `test/board-event-recorder.test.ts` | PASS |
| Recorder uses existing `append()` API (no board-specific repository methods) | `src/application/recording/board-event-recorder.ts:45` — `this.historyRepo.append()`; `src/adapters/sqlite/operational-history-repository.ts:55` — generic `append()` method | PASS |
| Event maps to `MissionTransition` for `buildMetrics` compatibility | `src/application/recording/board-event-recorder.ts:132` — `laneTransitionEventToMissionTransition()`; `src/domain/mission-workflow.ts:28` — `MissionTransition` interface | PASS |
| Restricted Area: `operational-history-repository.ts` unchanged | No modifications to `src/adapters/sqlite/operational-history-repository.ts` | PASS |
| CP-2 tests pass | `node --import tsx --test test/board-event-recorder.test.ts` → 6 pass / 0 fail | PASS |

## Next action

CP-3: integrate the recorder into `transitionTaskOnIntegrationBranch`
(`src/platform/runtime/lib/tools/backlog.ts`) as the single write point,
then write the guardrail test (SC2, SC3) verifying no other module calls the
recorder.

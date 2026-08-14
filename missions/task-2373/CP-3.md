# CP-3 — Operation-aware replacement and termination (SC8–SC9)

## Summary of work done

`reconcileCurrentWork` in `src/application/projections/current-work.ts` was rewritten in
place — no second classifier was added beside it. It no longer picks "the newest event for
the mission":

- events are grouped per mission and ordered by the operational store's own row order
  (`CurrentWorkEvent.sequence`), falling back to `occurredAt` for events that never reached
  the store;
- a `running` event always becomes the standing work;
- a terminal (`ended`/`blocked`) event is accepted **only** from the operation that owns the
  standing work, so an old operation finishing after newer work started can no longer blank
  the mission or hijack its blocking reason;
- an empty `operationId` (legacy rows written before publication carried one) keeps the old
  correlation-free behaviour rather than becoming permanently unclearable.

`parseCurrentWorkEntry` now carries the stored row id through as `sequence`, which is what
makes same-millisecond ordering deterministic. `test/current-work-publication.test.ts`'s
round-trip assertion was updated for the new field.

No new aggregate: this is still one event type on `operational_history`, keyed by mission,
correlated by the `operationId` string that already existed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC8 — a terminal event clears only its own operation | `test/task-2373-operation-aware.test.ts`, `"SC8: a terminal event from a superseded operation leaves the newer work standing"` and `"SC8: a terminal event clears the work of the operation it belongs to"` | PASS |
| SC8 — a superseded operation cannot inject a blocking reason | `test/task-2373-operation-aware.test.ts`, `"SC8: a blocked event for the standing operation still surfaces its reason"` (positive case) plus the `blockingReason === null` assertion in the superseded-operation test | PASS |
| SC8 — legacy rows without an operation id still clear | `test/task-2373-operation-aware.test.ts`, `"SC8: legacy rows published without an operation id keep clearing the mission"` | PASS |
| SC9 — deterministic under identical timestamps via durable store order | `test/task-2373-operation-aware.test.ts`, `"SC9: durable store order decides between two events written in the same millisecond"`; red companion `test/task-2373-repro.test.ts`, `"TASK-2373 defect 3: same-operation replacement is deterministic under identical timestamps"` | PASS |
| SC9 — the ordering key is the store's row id, not the publisher's clock | `test/task-2373-operation-aware.test.ts`, `"SC9: the durable sequence comes from the stored row id, not from the publisher"` | PASS |
| SC1 defect 3 (both cases) now green | `npx tsx --test test/task-2373-repro.test.ts` — the two `"TASK-2373 defect 3: …"` tests pass | PASS |
| Existing reconciliation contract preserved | `test/current-work-reconciliation.test.ts` — `"current work keeps automatic family handoff working and makes exhaustion actionable"`, `"current work distinguishes unverified, stale, and known-stopped publishers"` | PASS |
| No new run/attempt/lease aggregate | `test/domain-attempt-guard.test.ts` (runs in `npm test` below) | PASS |
| Suite state after CP-3 | `npm test` — tests 2268, pass 2266, fail 2; both failures are the intentionally-red CP-8 (`"TASK-2373 defect 5: board current-work reads do not grow with historical current-work rows"`) and CP-7 (`"TASK-2373 defect 6: q terminates a real px board while a confirmation dialog is armed"`) characterization tests | PASS (no unexpected failure) |

Next action: CP-4 — carry autonomous exhaustion into the operator-facing blocking reason and
prove the four WORKING/NEEDS YOU states in `src/application/projections/board.ts`'s
`attentionReason`, without turning a recoverable family failover into attention (SC10–SC12).

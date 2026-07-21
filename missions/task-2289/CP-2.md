# CP 2 — Executable application contracts and services

## Summary

Added UI-neutral terminal outcomes, typed errors, source/staleness projections,
ordered progress, cancellation, and capability contracts. `StatsBackfillService`
and `ActiveService` now execute through the minimum consumer-owned ports; strict
fake tests cover call ordering, rejection before mutation, cancellation with
partial durable evidence, and adapter failure outcomes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Terminal outcomes, typed errors, source/staleness, progress, and capabilities are application-owned | `lib/application/contracts.ts:1`; `lib/application/contracts.ts:23`; `lib/application/contracts.ts:29` | PASS |
| Ports expose only service-invoked operations | `lib/application/ports.ts:13`; `lib/application/ports.ts:23` | PASS |
| Stats service rejects capability and cancels before apply mutation | `lib/application/stats-backfill-service.ts:17`; `lib/application/stats-backfill-service.ts:23`; `"stats service rejects apply capability before any mutation-port call"` | PASS |
| Active service preserves launch-record-handoff order and safe cancellation evidence | `lib/application/active-service.ts:28`; `lib/application/active-service.ts:32`; `"active cancellation after durable record reports partial evidence without rollback claim"` | PASS |
| Strict fakes prove arguments, order, and no forbidden mutation calls | `test/application-services.test.ts`; `"active service calls strict ports in launch-record-handoff order"` | PASS |
| Adapter failure does not become completed | `"active adapter failure cannot produce a completed result"` | PASS |
| Focused contract and service tests pass | `node test/run-default-tests.js test/application-contracts.test.ts test/application-services.test.ts` | PASS |

Next action: add legacy-facing adapter wrappers, the sole production composition root, and fail-closed import/wiring guard fixtures.

# CP 2 — Stats projection delegation

## Summary

Delegated every non-help `stats-backfill` runtime path to the composed
`StatsBackfillService`. The CLI now parses `--apply`, `--json`, and
`--csv-file`, invokes the service once, and renders only a completed
projection. The legacy adapter supplies the full row projection (including
unresolved and skipped representations) and applies rows only after the
service has projected them. An application failure prints the existing failure
channel and returns before JSON/text success rendering.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 preserves help, text, JSON, report-only, and apply characterization | `test/stats-backfill.test.ts`; `"statsBackfill supports help, json output, summary output, and apply mode"` | PASS |
| SC2 sends every non-help stats path through the application service and renders only completed outcomes | `lib/commands/stats-backfill.ts:379`; `lib/commands/stats-backfill.ts:387`; `lib/application/stats-backfill-service.ts:22` | PASS |
| SC2 applies rows only after projection and preserves skipped/unresolved projection fields | `lib/application/stats-backfill-service.ts:22`; `lib/application/stats-backfill-service.ts:26`; `lib/adapters/legacy-stats-backfill-adapter.ts:8` | PASS |
| SC5 rejects capability before mutation and cancels before the apply port | `test/application-services.test.ts`; `"stats service rejects apply capability before any mutation-port call"`; `"stats service cancels at the safe boundary before applying rows"` | PASS |
| SC7 retains CLI rendering at the edge | `lib/commands/stats-backfill.ts:353`; `lib/commands/stats-backfill.ts:408`; `test/stats-backfill.test.ts` | PASS |
| SC8 retains complete concrete construction in the composition root | `lib/composition/application-services.ts:11`; `"composition guard accepts the sole production composition root"` | PASS |
| Focused stats, application, and boundary tests pass | `node test/run-default-tests.js test/stats-backfill.test.ts test/application-services.test.ts test/application-boundaries.test.ts` | PASS |

Next action: replace `active` handler lifecycle orchestration with the composed `ActiveService` while retaining usage parsing and exit-code presentation.

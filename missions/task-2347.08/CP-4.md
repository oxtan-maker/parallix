# CP-4 — Final verification

The shared service is used by both statistics consumers, the parity regression
is green, board metrics use a named input, and the required verification gate
completed successfully on the committed implementation tree. Focused coverage
remains local and uses in-memory repositories only.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: CLI and board agree on mission count, completed identity, and cycle time | `test/task-2347.08-own-statistics-semantics-repro.test.ts`; `"task-2347.08 repro: CLI and board agree on identity, completions, and cycle time"` | Passed |
| SC2: shared service is the production owner of identity, completion, and windowing | `src/application/services/statistics-service.ts:25`; `src/application/services/statistics-service.ts:30`; `src/application/services/statistics-service.ts:35`; `"task-2347.08: CLI delegates identity, completion, and window rules to statistics service"` | Passed |
| SC3: offset-equivalent timestamps use one UTC hour bucket | `src/application/services/statistics-service.ts:58`; `"statistics service buckets equivalent offsets in the same UTC hour"` | Passed |
| SC4: ordered transitions avoid per-instant history rescan | `src/application/projections/metrics.ts:197`; `"task-2347.08: cumulative flow evaluates ordered transitions once"` | Passed |
| SC5: board metrics accepts a named input and has no positional cast dispatch | `src/application/projections/board.ts:205`; `"task-2347.08: board metrics accept named input without positional overload casts"` | Passed |
| SC6: regression was red before the refactor and green afterwards | `test/task-2347.08-own-statistics-semantics-repro.test.ts`; `npm test -- test/task-2347.08-own-statistics-semantics-repro.test.ts` | Passed |
| SC7: required verification gate completes | `./scripts/verify-local.sh all` | Passed: 1,859 tests, 0 failures |

Next action: Gate evidence has been captured; mission is ready for the lifecycle harness to hand off.

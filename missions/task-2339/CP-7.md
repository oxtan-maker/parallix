# CP-7: The loop's own writes no longer outlive the database handle

## Summary

The last symptom in the operator's log was

```
[WARN] Could not record review stats for task-2339: Review-state persistence failed for mission
task-2339, phase reviewing, round 1, stage write: Database is not open. Call open() before using
the adapter.
```

`recordStageStatsSafeFn` writes the Review aggregate through the Mission store, but both review-loop
call sites invoked it without `await` (`src/adapters/review/review-loop.ts:1240`,
`src/adapters/review/review-loop.ts:1498`). A fire-and-forget aggregate write has two failure modes,
and this mission hit both: it races whatever runs next on the shared connection — that is what
collided with the artifact consumer in CP-6 — and it can still be settling when the command closes
the handle, at which point the write is lost with a message about a closed database rather than
about the work that was dropped.

Fixes:

1. **The loop awaits its own writes.** Both stage-stats calls are awaited, and
   `recordStageStatsSafeFn` is typed `void | Promise<void>` so an injected synchronous stub stays
   valid. The stage that follows now starts against a settled aggregate.
2. **Composition drains before it closes.** `MissionStore` gains an optional `drain()`
   (`src/application/domain-ports.ts:37`), `SqliteMissionStore` implements it over the CP-6 queue
   (`src/adapters/sqlite/mission-store.ts:92`), and the composition-owned close awaits it
   (`src/composition/application-services.ts:228-234`). Every command path closes through that one
   wrapper, so a write accepted by the handle reaches the database that accepted it.

No command opens a second connection: the shared handle stays exactly as composition built it, only
the order of close versus in-flight work changes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC17: the loop awaits its stage-stats write before the next stage | `src/adapters/review/review-loop.ts:1240`, `src/adapters/review/review-loop.ts:1498`; `"the review loop awaits its stage-stats write before moving on"` asserts `stats:end` precedes `consume` | PASS |
| SC18: `drain()` resolves only after in-flight work settles | `src/adapters/sqlite/mission-store.ts:92`; `"drain resolves only after an in-flight aggregate write has settled"` asserts the order `['write', 'drain']` | PASS |
| SC18: the composition-owned close awaits the drain | `src/composition/application-services.ts:228-234` (`await mission?.store.drain?.()` before `operatorState.close()`); `src/application/domain-ports.ts:37` declares the optional port method | PASS |
| SC19: reproduction test red before the fix, green after | `test/task-2339-writes-outlive-close.test.ts` — with `review-loop.ts` and `mission-store.ts` at the parent state: `pass 0 / fail 2`, the loop ordering reporting `stats:start, consume`; on this tree both pass | PASS |
| SC5: verification gate passes clean on the final tree | `` `./scripts/verify-local.sh all` `` — exit 0, `tests 1718 / pass 1718 / fail 0 / skipped 0` | PASS |
| Integration suite passes on the final tree | `` `npm run test:integration` `` — `tests 1541 / pass 1516 / fail 0 / skipped 25` (pre-existing skips) | PASS |
| SC6: no `.only` and no bare `.skip` introduced | `test/task-2339-writes-outlive-close.test.ts` uses only bare `test(...)`; gate reports `skipped 0` / `todo 0` | PASS |
| DoD #2: lint and static analysis clean on changed files | `` `./scripts/verify-local.sh static-analysis` `` — ESLint, `tsc --noEmit`, test-hygiene and test typecheck all PASS | PASS |
| Stop rule "no second SQLite connection" holds | `src/composition/application-services.ts` still passes the one `materializeOperatorState` handle to every consumer; the close wrapper adds no connection | PASS |
| Restricted areas untouched | `src/application/mission-lifecycle-service.ts`, `src/adapters/sqlite/board-lane-event-repository.ts` and `src/application/ports/operation-history.ts` are absent from the mission diff | PASS |

Next action: re-run the review loop from this worktree — with the store bound, a cross-family
reviewer, the aggregate race closed and in-flight writes awaited, codex's verdict should persist on
the first pass.

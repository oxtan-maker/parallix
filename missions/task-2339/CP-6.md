# CP-6: A concurrent read no longer observes the aggregate mid-rewrite

## Summary

With the store bound (CP-4) and a cross-family reviewer assigned (CP-5), the loop still dropped
codex's `approve`. The diagnostic this time came from the `no-review` branch added in CP-4 — the
store *was* present and the mission *did* load, without its Review.

`SqliteMissionStore.save` rewrites the value collections as DELETE-then-INSERT, and
`DELETE FROM mission_reviews` cascades to rounds, findings, resolutions, stage launches and the whole
review-event audit trail (`src/adapters/sqlite/migrations/0004-mission-aggregate.sql:81`,
`0008-review-workflow-state.sql:53`, `0010-review-events-and-implementer-response.sql:26`). The write
is transactional, but composition deliberately shares one `DatabaseSync` handle process-wide
(`src/composition/application-services.ts:311-314`), and a transaction gives a concurrent read on
that same handle no isolation. A `load` landing between the DELETE and the INSERT sees a mission
whose Review has vanished.

The review loop is exactly that workload — it records a reviewer stage launch while consuming
reviewer artifacts. The operator database shows the collision: `mission_review_stage_launches` for
`review:codex` carries `2026-08-04T10:28:11.486Z`, the same second the artifact consumer failed.

Fixes:

1. **Serialize aggregate access** (`src/adapters/sqlite/mission-store.ts:85`). `load`, `save` and
   `saveWithTransition` run through one queue, so no in-process read can interleave with a write on
   the shared handle. A rejected operation does not poison the chain — the next caller waits for the
   previous one to settle, not to succeed. Cross-process concurrency is unaffected: separate
   connections keep SQLite's own isolation.
2. **Stop deleting the row the children cascade from** (`src/adapters/sqlite/mission-store.ts:397`,
   `src/adapters/sqlite/mission-store.ts:475`). `mission_reviews` is upserted in place while the
   mission still has a Review, and its children are cleared explicitly; only a mission that genuinely
   has no Review deletes the row and lets the cascade run.

The `Database is not open. Call open() before using the adapter.` warning from `px active` is the
same shared-lifecycle family — composition closes the one handle while loop work is still in flight.
It is fixed in CP-7.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC14: an interleaved read returns the mission with its Review intact | `src/adapters/sqlite/mission-store.ts:85` (aggregate queue); `"a load that races an aggregate write never observes the mission without its Review"` | PASS |
| SC15: a save that keeps the Review never deletes `mission_reviews` | `src/adapters/sqlite/mission-store.ts:397`, `src/adapters/sqlite/mission-store.ts:475` (`ON CONFLICT(mission_id) DO UPDATE`); `"a save that keeps the Review never deletes the row its children cascade from"` | PASS |
| SC15: a save that drops the Review still clears every review table | `"a save that drops the Review still clears the review tables"` | PASS |
| SC16: reproduction test red before the fix, green after | `test/task-2339-aggregate-read-during-write.test.ts` — with `src/adapters/sqlite/mission-store.ts` at the parent state: `pass 1 / fail 2`, the racing read reporting `actual: null` for the Review; on this tree all three pass | PASS |
| SC5: verification gate passes clean on the final tree | `` `./scripts/verify-local.sh all` `` — exit 0, `tests 1718 / pass 1718 / fail 0` | PASS |
| SC6: no `.only` and no bare `.skip` introduced | `test/task-2339-aggregate-read-during-write.test.ts` uses only bare `test(...)`; gate reports `skipped 0` / `todo 0` | PASS |
| DoD #2: lint and static analysis clean on changed files | `` `./scripts/verify-local.sh static-analysis` `` — ESLint, `tsc --noEmit`, test-hygiene and test typecheck all PASS | PASS |
| Stop rule "no second connection" holds | `src/adapters/sqlite/mission-store.ts` takes the same injected `SqliteDatabaseAdapter` | PASS |
| Restricted areas untouched | `src/application/mission-lifecycle-service.ts`, `src/adapters/sqlite/board-lane-event-repository.ts` and `src/application/ports/operation-history.ts` are absent from the mission diff | PASS |

Next action: close the remaining shared-lifecycle gap in CP-7 — the loop's own in-flight writes —
before re-running the review loop.

# CP-4: Review loop bound to the Mission store

## Summary

The idempotent `submit-for-review` transition (CP-1..CP-3) removed the retry failure but did not
unblock review. A handoff that now transitions cleanly still lost every review event the loop
produced, because `resolveMissionStore` is a pure dependency-injection passthrough
(`return store ?? null`, `src/adapters/review/review-state.ts:112` and
`src/adapters/review/review-events.ts:27`) and two call paths were never handed the store.

Observed on this mission: the reviewer returned `verdict: approve` with complete artifacts, and the
loop reported

```
[FAIL] Cannot store review event for "task-2339": no Review in the operator database.
[FAIL] Failed to persist reviewer findings to repo store: No Review in the operator database for task-2339
[WARN] Reviewer claude produced incomplete or invalid review artifacts; retrying the reviewer.
```

while the Review was in fact present (`mission_reviews` row for `task-2339`, one round started
`2026-08-04T09:49:38.755Z`). The message sends the operator to `px review <slug> --backfill-review`,
which returns `already-present` and repairs nothing.

Fixes applied:

1. `reviewLoopBindings(store)` (`src/composition/review-persistence.ts:66`) returns the complete
   `startReviewLoop` injection set. Both composition roots spread it
   (`src/composition/create-cli.ts:147`, `src/composition/application-services.ts:202`), so no root
   can bind the review-state projections while leaving the artifact consumers unbound — which is
   exactly what `create-cli.ts` did, disabling `px review <slug> --start|--continue`.
2. `bindReviewPersistence` gained store-bound `consumeReviewerArtifacts` /
   `consumeImplementerArtifacts`, replacing the hand-rolled binding previously duplicated in
   `application-services.ts`.
3. The artifact consumers use the injected review-state reader
   (`src/adapters/review/review-artifacts.ts:362,498`) instead of calling `readReviewState`
   directly, so events carry the round in progress rather than defaulting to round 1.
4. `persistEventInStore` reports why it failed (`no-store` / `no-review` / `write-failed`) and
   `createEvent` names an unsupplied store as a wiring failure. Only the genuine missing-Review case
   still points at `--backfill-review`.

`resolveMissionStore` deliberately keeps no production fallback: adapters continue to receive the
store from composition (mission Out of Scope, and the CP-4 stop rule).

One existing expectation was retargeted rather than deleted: `review-events.test.ts`'s
`"createEvent fails loudly when the mission has no Review in the database"` passed no store, so it
was asserting the wrong diagnostic for the case it set up. It now covers the no-store case, and a
new sibling test covers the real missing-Review case with a store whose mission has `review: null`.

Restricted areas remain absent from the mission diff.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC7: `reviewLoopBindings` returns the complete injection set and both roots spread it | `src/composition/review-persistence.ts:66`; `src/composition/create-cli.ts:147`; `src/composition/application-services.ts:202`; `"reviewLoopBindings supplies the artifact consumers, not only the review-state projections"` | PASS |
| SC8: bound consumers append events to the Review aggregate with the round in progress | `"bound reviewer-artifact consumer persists its events to the operator database"` asserts `roundNumber` `[3, 3]` against a stored round 3; `"bound implementer-artifact consumer persists its events to the operator database"` | PASS |
| SC9: an unsupplied store is reported as such, and only a real missing Review names `--backfill-review` | `src/adapters/review/review-events.ts:527` (`no-store` branch); `"an unbound event writer reports the missing store, not a missing Review"`; `"createEvent fails loudly when the mission has no Review in the database"` in `test/review-events.test.ts` | PASS |
| SC10: binding reproduction test red before the fix, green after | `test/task-2339-review-store-bindings.test.ts` — with `src/` at the parent state the suite reports `fail 6` (`TypeError: reviewLoopBindings is not a function`, wrong round, old diagnostic); on this tree all pass | PASS |
| SC5: verification gate passes clean on the final tree | `` `./scripts/verify-local.sh all` `` — exit 0, `fail 0 / skipped 0 / todo 0` | PASS |
| SC6: no `.only` and no bare `.skip` introduced | `test/task-2339-review-store-bindings.test.ts` uses only bare `test(...)`; gate reports `skipped 0` / `todo 0` | PASS |
| DoD #2: lint and static analysis clean on changed files | `` `./scripts/verify-local.sh static-analysis` `` — ESLint, `tsc --noEmit`, test-hygiene and test typecheck all PASS | PASS |
| Live path unblocked | `` `px review task-2339 --consume-artifacts` `` persisted `reviewer_findings` and `reviewer_outcome` for round 1 (`missions/task-2339/review-events/2026-08-04T100246-*`); `` `px review task-2339 --status` `` reports round 1, phase reviewing | PASS |
| Stop rule "no database opened inside the adapter" holds | `src/adapters/review/review-state.ts:112` and `src/adapters/review/review-events.ts:27` still return the injected store or `null` | PASS |
| Restricted areas untouched | `git diff --name-only 8b8ba3c84..HEAD` excludes `src/application/mission-lifecycle-service.ts`, `src/adapters/sqlite/board-lane-event-repository.ts`, `src/application/ports/operation-history.ts` | PASS |

Next action: hand the mission off for review with both reproduction tests, flagging the retargeted
`review-events.test.ts` expectation and the new `reviewLoopBindings` seam for the reviewer.

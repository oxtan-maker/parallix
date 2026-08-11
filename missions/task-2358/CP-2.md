# CP-2: Rewrite loadReview() to Read Persisted Rounds

## Summary

Rewrote `ConcreteReviewReadAdapter.loadReview()` in `src/adapters/backlog/concrete-review-read-adapter.ts` to query `missionStore.load()` directly instead of relying on `readReviewState()` which flattens the Review to a single round.

**Change:** When `missionStore` is available, `loadReview()` calls `missionStore.load(missionId)` and returns `mission.review` directly — the fully hydrated `Review` domain object with all persisted rounds, findings, resolutions, and events. Falls back to `readReviewState()` path for zero-round missions or when store is null.

**Key insight:** `MissionStore.load()` already returns a complete `Review` (via `hydrateMission()` → `reviewFrom()` in `mission-serialization.ts`). The previous code threw this away by passing through `readReviewState()` which called `reviewStateDataFrom()` to flatten the Review to its last round only.

Regression test `test/task-2358-multi-round-repro.test.ts` turns green (3/3 pass). All 25 existing adapter tests pass. Static analysis clean.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Adapter reads persisted rounds from store | `src/adapters/backlog/concrete-review-read-adapter.ts:107-120` | PASS |
| SC1: rounds.length equals persisted row count | `"multi-round fixture does not collapse to 1 round"` — `assert.equal(review.rounds.length, 3)` | PASS |
| SC2: each round carries distinct persisted values | `test/task-2358-multi-round-repro.test.ts:194-207` (codex/claude/gemini, REQUEST_CHANGES/APPROVED) | PASS |
| SC3: findings populated for changes-requested rounds | `test/task-2358-multi-round-repro.test.ts:210-220` | PASS |
| SC4: resolutions populated for responded rounds | `test/task-2358-multi-round-repro.test.ts:223-229` | PASS |
| SC5: reviewEvents populated (not hardcoded []) | `test/task-2358-multi-round-repro.test.ts:232` — `assert.equal(review.reviewEvents.length, 3)` | PASS |
| SC7: zero-round fallback to flat ReviewState | `"zero-round mission falls back to flat ReviewState"` | PASS |
| SC8: regression test exists, runs, fails on parent | `test/task-2358-multi-round-repro.test.ts` | PASS |
| Existing adapter tests pass | `test/adapters/concrete-adapters-cp2.test.ts` — 25/25 pass | PASS |
| Static analysis clean | `` `./scripts/verify-local.sh static-analysis` `` | PASS |

Next action: CP-3 — Run full gate `` `./scripts/verify-local.sh all` `` and verify end-to-end with `px status` on a real multi-round mission.

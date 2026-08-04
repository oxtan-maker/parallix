# CP-3 — Composition store wiring

Board-projection composition now accepts the already-composed mission authority and passes it to `ConcreteReviewReadAdapter`. Production capabilities receive the same store created by the application-services composition root, avoiding a second database handle.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Board composition dependency includes a MissionStore | `src/composition/board-projection.ts:24` | PASS |
| Concrete review adapter receives the composed store | `src/composition/board-projection.ts:38` | PASS |
| Production composition forwards its mission authority | `src/composition/application-services.ts:216` | PASS |
| Board composition regression coverage remains green | `test/adapters/board-projection-builder-cp3.test.ts`, `npm test -- test/adapters/board-projection-builder-cp3.test.ts` | PASS |

Next action: enrich each board mission with `loadReview()` before projecting its card.

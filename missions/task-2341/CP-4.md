# CP-4 — Projection review enrichment

`BoardProjectionBuilder.build()` now loads the full review state for every mission in parallel with approval and gate data. It passes a copy of the mission with that review attached to `projectMissionCard()`, preserving the existing card contract while populating its review fields.

The board-reader mock now accepts a review value, and a focused test verifies that the projected card exposes its review phase and current round.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Projection builder loads the full review | `src/application/projections/board-readers.ts:109` | PASS |
| Projection uses the review-enriched mission | `src/application/projections/board-readers.ts:123` | PASS |
| Board-reader mock models a returned review | `test/board-readers.test.ts:39` | PASS |
| Enriched board-card behavior is tested | `"BoardProjectionBuilder projects the review loaded by its review adapter"` | PASS |

Next action: run the reproduction and full mission verification gates, then record final committed evidence.

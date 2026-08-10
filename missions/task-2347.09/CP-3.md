# CP-3 — Review bounce rate derived from lane transitions

## Summary

The review bounce rate is computed from `review → active` lifecycle transitions
in the lane history, never from the `pr_fix_rounds` usage column.

- `reviewPassagesByMission()` (`src/application/projections/cohorts.ts:148`)
  reads each mission's review passage from `MissionTransition[]`: whether it
  entered review at all, and how many times it was sent back. A mission that
  bounced is treated as having entered review even if the entering transition
  itself was never recorded, so an incomplete history cannot produce a rate
  above 1 by shrinking the denominator.
- `compareCohorts()` (`src/application/projections/cohorts.ts:233`) divides the
  cohort's total bounces by the number of its missions that entered review.
  Missions that never reached review are excluded from the denominator, and a
  cohort where nothing reached review reports `null` rather than `0`.
- `pr_fix_rounds` is still projected onto `MissionOutcome.reviewFixRounds` and
  surfaced as `medianReviewFixRounds`, but it is a separate figure from the
  bounce rate and is never used to compute it.

`test/task-2347.09-bounce-rate.test.ts` runs three missions through the real
read adapter. Two bounce out of review once each and one is approved on the
first pass, so the expected rate is 2/3 ≈ 0.667. The seeded `pr_fix_rounds`
values deliberately contradict the lane history — 0 for both bouncing missions
and 5 for the clean one — so an implementation reading fix rounds would report
5/3 ≈ 1.667 and fail the test.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4: review bounce rate computed from `review → active` transitions in lane history; 3 missions, 2 with bounces, rate 2/3 | `test/task-2347.09-bounce-rate.test.ts`; test `"SC4: review bounce rate is 2/3 when 2 of 3 missions bounce out of review"` | PASS |
| SC4: the rate is not derived from `pr_fix_rounds` | test `"SC4: the bounce rate ignores pr_fix_rounds, which disagrees with lane history"` — fix rounds seeded 0/0/5 would yield 5/3; the asserted rate is below 1 | PASS |
| Bounces and review entries are read per mission from transitions | `src/application/projections/cohorts.ts:148`; test `"SC4: review passages count entries and bounces per mission from lane transitions"` | PASS |
| A mission that never entered review is excluded from the denominator | test `"SC4: a mission that never entered review is excluded from the rate denominator"` in `test/task-2347.09-bounce-rate.test.ts` | PASS |
| The rate is exercised through the real projection, not a hand-built outcome list | `test/task-2347.09-bounce-rate.test.ts` builds outcomes via `metricsAdapter(...).readOutcomes()` over seeded `UsageRecord` and `BoardLaneEventEntry` rows (`test/fixtures/metrics-adapter.ts`) | PASS |
| CP-3 tests pass | `npm test -- test/task-2347.09-bounce-rate.test.ts` — 4 pass, 0 fail | PASS |
| Test typecheck clean | `npx tsc --noEmit --project tsconfig.test.json` reports no output | PASS |

Next action: add the `px stats cohorts` subcommand and its board-facing
presentation — a table where every cohort row carries its `n` column and cohorts
with `n < 5` are marked low-sample — covered by
`test/task-2347.09-cohort-presentation.test.ts`, plus the optional `cohorts`
field on `BoardMetrics` (CP-4).

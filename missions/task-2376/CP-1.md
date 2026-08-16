# CP-1 — Contemporary Review authority invariant

## Summary

Audited the current domain transition rules, lifecycle persistence boundary, and every
production `approve` command producer. A normal contemporary Mission cannot reach
`integration` without a persisted Review aggregate. There is no genuine supported
Review-less workflow to preserve.

`submit-for-review` requires a `Review` and persists it on the Mission before it can
enter `review`. The only transition into `integration` is `approve`; it requires the
Mission's Review to match the command Review and to be approved. The current
`px integrate` repair path also loads that persisted Mission Review before invoking
`approve`. Its defect is timestamp authority (`new Date()`), not a Review-less
transition. The remaining legacy shortcut is `review → done` in the domain's
`integrate` case; it does not create `integration` and will be removed in CP-5.

Review-loop writers likewise fail closed when no Review is present. Legacy
`review-state.json` data requires the explicit `px review --backfill-review` operator
operation; it is not a normal workflow that can silently establish lifecycle truth.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A submitted contemporary Mission has a Review aggregate before it enters `review` | `src/domain/mission-workflow.ts` `submit-for-review`; `test/domain-mission.test.ts` | PASS |
| The only normal transition into `integration` requires an approved matching Review | `src/domain/mission-workflow.ts` `approve`; `test/domain-mission.test.ts` | PASS |
| Lifecycle persistence cannot bypass the domain decision | `src/application/mission-lifecycle-service.ts` `MissionLifecycleService.transition()` invokes `decideMission` before save | PASS |
| Every production `approve` caller has been accounted for | `src/adapters/cli/commands/integrate.ts` `promoteTaskForIntegrationIfNeeded`; `rg -n "command: { type: 'approve'" src` | PASS |
| Review-loop persistence fails closed when no aggregate exists | `src/adapters/review/review-state.ts` `readReviewState` and documented explicit `px review --backfill-review` recovery | PASS |
| No genuine supported Review-less workflow reaches `integration` | `src/domain/mission-workflow.ts`; `src/application/mission-lifecycle-service.ts`; `src/adapters/cli/commands/integrate.ts` | PASS |
| Existing legacy shortcut is correctly classified as `review → done`, not a Review-less integration path | `src/domain/mission-workflow.ts` `integrate`; `test/domain-mission.test.ts` | PASS |

Next action: CP-2 — add the R1–R3 and R8 red regression coverage in `test/task-2376-lifecycle-timing.test.ts`, run it against the CP-0 baseline, and record the expected failures.

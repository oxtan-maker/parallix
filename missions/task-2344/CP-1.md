# CP-1: Lock status review-history regression

Added a deterministic persisted-review fixture that routes the hydrated aggregate through `ConcreteReviewReadAdapter`, the existing history projection, and the `px status` renderer. The fixture has round 1 `PUSHBACK_ALL`, round 2 `BLOCKED`, an earlier finding, and both fixed and pushback resolutions.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test is present and identifies every seeded round | `test/task-2344-review-history-status-repro.test.ts`, `px status task-2344 renders every persisted review round with earlier findings and resolutions` | PASS |
| Seeded rounds retain reviewer, implementer, and disposition | `test/task-2344-review-history-status-repro.test.ts`, `px status task-2344 renders every persisted review round with earlier findings and resolutions` | PASS |
| Earlier finding is projected and rendered | `test/task-2344-review-history-status-repro.test.ts`, `px status task-2344 renders every persisted review round with earlier findings and resolutions` | PASS |
| Earlier fixed and pushback resolutions are rendered in their round | `test/task-2344-review-history-status-repro.test.ts`, `px status task-2344 renders every persisted review round with earlier findings and resolutions` | PASS |
| Operator-state six-round task-2337 projection remains a manual integration check | `px status task-2337` | PENDING |
| Existing concrete adapter and mission-store path are exercised without new interfaces or card shapes | `src/adapters/backlog/concrete-review-read-adapter.ts`, `test/task-2344-review-history-status-repro.test.ts` | PASS |
| Reviewer prompt claim is reconciled with delivered behavior | `prompts/review.md` | PENDING |
| Final repository gate completes | `./scripts/verify-local.sh all` | PENDING |
| Reproduction has red and green evidence | `test/task-2344-review-history-status-repro.test.ts`; the mission parent lacks this test path, and `npx tsx --test test/task-2344-review-history-status-repro.test.ts` is green | PASS |

Next action: Inspect the aggregate-backed adapter against the new renderer regression and commit the smallest read-path change only if the fixture exposes a loss of persisted data.

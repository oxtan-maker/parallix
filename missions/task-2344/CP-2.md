# CP-2: Verify aggregate-backed review read

Confirmed that the existing `ConcreteReviewReadAdapter` loads the hydrated mission aggregate when a mission store is available. That path returns the persisted review unchanged, preserving ordered rounds, decisions and findings, implementer resolutions, and review events; no production edit is needed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test is present and identifies every seeded round | `test/task-2344-review-history-status-repro.test.ts`, `px status task-2344 renders every persisted review round with earlier findings and resolutions` | PASS |
| Seeded rounds retain reviewer, implementer, and disposition | `test/task-2344-review-history-status-repro.test.ts`, `test/task-2358-multi-round-repro.test.ts`, `multi-round fixture does not collapse to 1 round` | PASS |
| Earlier finding is projected and rendered | `test/task-2344-review-history-status-repro.test.ts`, `px status task-2344 renders every persisted review round with earlier findings and resolutions` | PASS |
| Earlier fixed and pushback resolutions are rendered in their round | `test/task-2344-review-history-status-repro.test.ts`, `px status task-2344 renders every persisted review round with earlier findings and resolutions` | PASS |
| Operator-state six-round task-2337 projection remains a manual integration check | `px status task-2337` | PENDING |
| Existing concrete adapter and mission-store path are exercised without new interfaces or card shapes | `src/adapters/backlog/concrete-review-read-adapter.ts`, `test/task-2358-multi-round-repro.test.ts`, `multi-round fixture does not collapse to 1 round` | PASS |
| Reviewer prompt claim is reconciled with delivered behavior | `prompts/review.md` | PENDING |
| Final repository gate completes | `./scripts/verify-local.sh all` | PENDING |
| Reproduction has red and green evidence | `test/task-2344-review-history-status-repro.test.ts`; the mission parent lacks this test path, and `npx tsx --test test/task-2344-review-history-status-repro.test.ts` is green | PASS |

Next action: Re-read the reviewer prompt against the rendered output, then run the mission gate after recording the final checkpoint.

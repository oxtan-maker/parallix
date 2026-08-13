# CP-3: Complete status-history coverage and verification

The delivered renderer now has a deterministic aggregate-to-status regression. The reviewer prompt says that the `Review:` block reports each recorded round, matching the command’s current-round summary followed by its complete history. The required verification gate passed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test identifies every seeded round in status output | `test/task-2344-review-history-status-repro.test.ts`, `px status task-2344 renders every persisted review round with earlier findings and resolutions` | PASS |
| Seeded PUSHBACK_ALL and BLOCKED rounds retain reviewer and implementer families | `test/task-2344-review-history-status-repro.test.ts`, `px status task-2344 renders every persisted review round with earlier findings and resolutions` | PASS |
| Earlier finding is projected and rendered in its round | `test/task-2344-review-history-status-repro.test.ts`, `px status task-2344 renders every persisted review round with earlier findings and resolutions` | PASS |
| Earlier fixed and pushback resolutions are rendered in their round | `test/task-2344-review-history-status-repro.test.ts`, `px status task-2344 renders every persisted review round with earlier findings and resolutions` | PASS |
| Operator-state task-2337 can be checked for six persisted rounds | `px status task-2337` | MANUAL |
| Existing concrete adapter and mission-store path are used without changing card shapes or interfaces | `src/adapters/backlog/concrete-review-read-adapter.ts`, `test/task-2358-multi-round-repro.test.ts`, `multi-round fixture does not collapse to 1 round` | PASS |
| Reviewer prompt matches delivered status behavior | `prompts/review.md`, `test/task-2344-review-history-status-repro.test.ts` | PASS |
| Repository verification gate completes on the final implementation | `./scripts/verify-local.sh all` | PASS |
| Reproduction records red and green state | `test/task-2344-review-history-status-repro.test.ts`; the mission parent lacks this test path, and `npx tsx --test test/task-2344-review-history-status-repro.test.ts` passes | PASS |

Next action: Hand the committed mission to the review workflow; an operator with task-2337 history may run `px status task-2337` as the documented manual integration confirmation.

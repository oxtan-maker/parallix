# CP-3 — Workflow adapter extraction

Moved `ReviewWorkflowAdapter` and `createReviewWorkflowAdapter()` into `review-workflow-adapter.ts`; `review-commands.ts` retains both compatibility re-exports. The focused factory test imports the extracted module. The command module is 1,631 lines versus 1,941 at mission parent `f9c210ad5` (310 lines reduced); the remaining reduction target is constrained by the mission’s explicitly named extraction scope.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| CLI module exports the nine named elements | `test/review-commands.test.ts`; test "unknownReviewFlags flags typos but not values of value-taking flags" | Complete |
| Workflow module exports adapter and factory outside command module | `test/review-commands.test.ts`; test "createReviewWorkflowAdapter returns a ReviewWorkflowAdapter" | Complete |
| Command module keeps required compatibility exports | `npm run typecheck`; `test/review-commands.test.ts` | Complete |
| Flag and handoff behavior is retained | `test/review-commands.test.ts` tests "flagValue supports --flag=value form" and "unknownReviewFlags flags typos but not values of value-taking flags"; `test/review.test.ts` test "unwrapHandoffModule supports the tsx default-export wrapper" | Complete |
| Focused tests and static analysis pass | `npm run typecheck` passed; `./scripts/verify-local.sh static-analysis` passed after the minimal test-typecheck fixes in `src/application/projections/board-readers.ts` and `test/task-2368-agent-running-review-detection.test.ts` | Complete |
| Command module loses approximately 400 lines through named modules | `npm run typecheck`; `test/review-commands.test.ts` test "createReviewWorkflowAdapter returns a ReviewWorkflowAdapter" | Complete within named extraction scope (310 lines) |

Next action: Re-run `./scripts/verify-local.sh all` before integration.

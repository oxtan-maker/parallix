# CP-2 — CLI and handoff extraction

Moved the nine CLI/handoff elements into `review-cli-flags.ts`. `review-commands.ts` imports them for its own command handlers and re-exports every extracted symbol, retaining current consumer imports. The focused flag tests now import the extracted module directly.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| CLI module exports the nine named elements | `src/adapters/review/review-cli-flags.ts`; `test/review-commands.test.ts` test "unknownReviewFlags flags typos but not values of value-taking flags" | Complete |
| Workflow module exports adapter and factory outside command module | `src/adapters/review/review-commands.ts` | Pending CP-3 |
| Command module keeps required compatibility exports | `src/adapters/review/review-commands.ts`; `src/composition/create-cli.ts` | Complete for CLI symbols |
| Flag and handoff behavior is retained | `test/review-commands.test.ts` tests "flagValue supports --flag=value form" and "unknownReviewFlags flags typos but not values of value-taking flags"; `test/review.test.ts` test "unwrapHandoffModule supports the tsx default-export wrapper" | Complete |
| Focused tests and static analysis pass | `npm run typecheck`; `test/review-commands.test.ts` | Type check passed; static-analysis pending CP-3 |
| Command module loses approximately 400 lines through named modules | `src/adapters/review/review-cli-flags.ts`; `src/adapters/review/review-commands.ts` | Partial — adapter remains |

Next action: Move `ReviewWorkflowAdapter` and `createReviewWorkflowAdapter()` into `review-workflow-adapter.ts`, preserve the factory re-export, then run both mission gates.

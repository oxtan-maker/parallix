# CP-1 — Review extraction map

Mapped the nine CLI/handoff exports, their `review-commands.ts` call sites, existing compatibility consumers, and focused tests. The compatibility surface is `flagValue`, `readTextFlag`, `unknownReviewFlags`, `unwrapHandoffModule`, and `createReviewWorkflowAdapter`; the remaining extracted symbols have no direct repository import found and will still be re-exported as required.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| CLI module exports the nine named elements | `src/adapters/review/review-commands.ts`; `test/review-commands.test.ts` test "unknownReviewFlags flags typos but not values of value-taking flags" | Mapped — CP-2 |
| Workflow module exports adapter and factory outside command module | `src/adapters/review/review-commands.ts`; `src/adapters/cli/commands/review.ts` | Mapped — CP-3 |
| Command module keeps required compatibility exports | `src/composition/create-cli.ts`; `test/review-commands-supplemental.test.ts` | Mapped — CP-2/CP-3 |
| Flag and handoff behavior is retained | `test/review-commands.test.ts` test "flagValue supports --flag=value form"; `test/review.test.ts` test "unwrapHandoffModule supports the tsx default-export wrapper" | Covered baseline |
| Focused tests and static analysis pass | `test/review-commands.test.ts`; `./scripts/verify-local.sh static-analysis` | Pending extraction gate |
| Command module loses approximately 400 lines through named modules | `src/adapters/review/review-commands.ts`; `src/adapters/review/review-cli-flags.ts`; `src/adapters/review/review-workflow-adapter.ts` | Pending extraction |

Next action: Move the CLI/handoff helpers into `review-cli-flags.ts`, retain `review-commands.ts` compatibility exports, and run the focused flag tests.

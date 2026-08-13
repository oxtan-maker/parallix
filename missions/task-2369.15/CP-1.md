# CP 1: Extract draft concerns

Moved the scoped setup, prompt, conflict, and workflow-stat helpers into their designated command modules. `draft.ts` now composes those modules and preserves its established exports.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Draft entry point delegates the four scoped concerns | `src/adapters/cli/commands/draft.ts`, `src/adapters/cli/commands/draft-setup.ts`, `src/adapters/cli/commands/draft-prompts.ts`, `src/adapters/cli/commands/draft-conflicts.ts`, `src/adapters/cli/commands/draft-stats.ts` | PASS |
| Scoped functions remain available through the draft command surface | `src/adapters/cli/commands/draft.ts` | PASS |
| Draft setup, prompts, conflicts, and stats behavior retains dependency seams | `test/draft.test.ts`, `test/draft-command.test.ts` | PENDING CP 2 verification |
| Focused mocked coverage avoids live Forgejo and agent execution | `test/draft.test.ts`, `test/draft-command.test.ts` | PENDING CP 2 verification |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PENDING CP 3 gate |

Next action: run and repair the focused draft tests, then add boundary-specific coverage where the extraction exposed a seam.

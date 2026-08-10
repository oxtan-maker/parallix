# CP-1 — Application review workflow boundary

Defined the application-owned review workflow port and added the CLI-independent `ReviewCommandUseCase`. The use case performs ordered flag dispatch through the port, so no adapter implementation is required to select the review lifecycle operation.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Review workflow port enumerates lifecycle operations | `src/application/ports/review-workflow.ts:8` | PASS |
| Use case accepts the port and dispatches review flags | `src/application/review-command-use-case.ts:4` | PASS |
| TypeScript accepts the new application boundary | `npx tsc --noEmit` | PASS |

Next action: Add the pure review CLI parser and command handler, then compose it in the review CLI adapter.

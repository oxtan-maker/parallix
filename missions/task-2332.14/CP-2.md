# CP-2 — Review CLI interface and composition

Added a pure review CLI parser that recognizes the established review flags and retains typo diagnostics. The review command adapter now creates the application use case through the interface handler rather than importing a dispatcher.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Pure CLI parser is available from the interface layer | `src/interfaces/cli/review.ts:16` | PASS |
| CLI handler renders parse diagnostics before use-case delegation | `src/interfaces/cli/review.ts:36` | PASS |
| Review command adapter composes the handler and use case | `src/adapters/cli/commands/review.ts:1` | PASS |
| Static type verification succeeds | `npx tsc --noEmit` | PASS |

Next action: Run the existing review command suite against the adapter-backed port implementation and resolve migration compatibility failures.

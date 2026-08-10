# CP-1 — Red interrupted-handoff reproduction

Added the hermetic reproduction for a review-status Mission that has no Review aggregate. It first proves the existing review-loop persistence failure, then specifies the required reconciliation result from explicit canonical handoff input.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Red reproduction proves the missing-Review persistence failure | `test/task-2350-reconcile-interrupted-handoff.test.ts`; `"reconciles an interrupted handoff before review-loop state is saved"` | PASS |
| Recovery creates round-one aggregate from canonical handoff inputs without status mutation | `test/task-2350-reconcile-interrupted-handoff.test.ts` | IN PROGRESS — red until CP-2 |
| Repeated recovery remains idempotent | `test/task-2350-reconcile-interrupted-handoff.test.ts` | PENDING |
| Status and review command proceed after reconciliation | `src/adapters/cli/commands/status.ts:254`; `src/adapters/review/review-commands.ts:1883` | PENDING |
| Ambiguous, missing, and malformed inputs fail before launch or persistence | `src/adapters/review/review-state.ts:544` | PENDING |
| Repository verifier passes | `./scripts/verify-local.sh all` | PENDING |

Next action: Implement the explicit canonical-input reconciliation boundary in `src/adapters/review/review-state.ts` and turn the red reproduction green.

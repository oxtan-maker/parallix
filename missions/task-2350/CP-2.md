# CP-2 — Canonical-input Review reconciliation

Implemented an explicit reconciliation boundary that accepts only branch, target, reviewer, implementer, revision, eligibility, and the recovery start time. It creates a valid round-one aggregate only for a Mission already in `review`, and retries leave an existing aggregate untouched.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Red reproduction proves the missing-Review persistence failure | `"reconciles an interrupted handoff before review-loop state is saved"` | PASS |
| Recovery creates round-one aggregate from canonical handoff inputs without status mutation | `src/adapters/review/review-state.ts:252`; `test/task-2350-reconcile-interrupted-handoff.test.ts` | PASS |
| Repeated recovery remains idempotent | `src/adapters/review/review-state.ts:286`; `"reconciles an interrupted handoff before review-loop state is saved"` | PASS |
| Status and review command proceed after reconciliation | `src/adapters/cli/commands/status.ts:254`; `src/adapters/review/review-commands.ts:1883` | PENDING |
| Ambiguous, missing, and malformed inputs fail before launch or persistence | `src/adapters/review/review-state.ts:261` | IN PROGRESS |
| Repository verifier passes | `./scripts/verify-local.sh all` | PENDING |

Next action: Expose reconciliation through `px review`, then guard reviewer launch and add status plus fail-closed coverage.

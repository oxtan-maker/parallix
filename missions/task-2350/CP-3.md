# CP-3 — Guarded review entry and fail-closed recovery

Added the explicit `px review <slug> --reconcile-review` boundary. It requires a Backlog task already in `review` plus all canonical handoff inputs, and a guarded review start refuses to launch when the injected Mission authority reports no aggregate. Focused tests keep Forgejo and agent launch seams mocked.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Red reproduction proves the missing-Review persistence failure | `"reconciles an interrupted handoff before review-loop state is saved"` | PASS |
| Recovery creates round-one aggregate from canonical handoff inputs without status mutation | `src/adapters/review/review-state.ts:252`; `"reconciles an interrupted handoff before review-loop state is saved"` | PASS |
| Repeated recovery remains idempotent | `src/adapters/review/review-state.ts:304`; `"reconciles an interrupted handoff before review-loop state is saved"` | PASS |
| Status and review command proceed after reconciliation | `src/adapters/review/review-commands.ts:1744`; `"px status reports a started review after reconciliation"` | PASS |
| Ambiguous, missing, and malformed inputs fail before launch or persistence | `"reconciliation fails closed for ambiguous identity, missing Mission, and malformed legacy Review data"` | PASS |
| Repository verifier passes | `./scripts/verify-local.sh all` | PENDING |

Next action: Run `./scripts/verify-local.sh all`, record its exact result in CP-4, and commit the completed checkpoint before handoff.

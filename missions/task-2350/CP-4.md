# CP-4 — Verification complete

Completed the required repository verification. The recovery command is explicitly bound to the authoritative Mission store, refuses non-review Backlog tasks and incomplete canonical inputs, and blocks reviewer launch when the bound Mission state has no valid Review aggregate.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| The red reproduction proves the original missing-Review persistence failure and successful recovery | `test/task-2350-reconcile-interrupted-handoff.test.ts:27`; `"reconciles an interrupted handoff before review-loop state is saved"` | PASS |
| Reconciliation creates a valid round-one aggregate from branch, target, identities, revision, and eligibility without changing Mission or Backlog status | `src/adapters/review/review-state.ts:287`; `src/adapters/review/review-commands.ts:1761`; `"reconciles an interrupted handoff before review-loop state is saved"` | PASS |
| A second reconciliation preserves the existing aggregate | `src/adapters/review/review-state.ts:307`; `test/task-2350-reconcile-interrupted-handoff.test.ts:61` | PASS |
| `px status` reports the started review and `px review` stops before launch until reconciliation, then reaches its launch boundary | `src/adapters/review/review-commands.ts:1950`; `"px review reconciles canonical inputs then reaches the reviewer-launch boundary"`; `"px status reports a started review after reconciliation"` | PASS |
| Ambiguous identity, missing Mission, and malformed legacy Review data fail closed before persistence or launch | `src/adapters/review/review-state.ts:294`; `src/adapters/review/review-state.ts:301`; `src/adapters/review/review-state.ts:308`; `"reconciliation fails closed for ambiguous identity, missing Mission, and malformed legacy Review data"` | PASS |
| Required repository verifier succeeds | `./scripts/verify-local.sh all` | PASS |

Next action: Commit CP-4 after refreshing `graphify-out/` so the review-ready tree contains the final verification evidence.

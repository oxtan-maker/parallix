# CP-4: Make malformed-gate classification locale-independent

Added English and Swedish Bash syntax diagnostic coverage to prove that declared-gate validation classification comes from the structured `declared-gate-validation` reason, not shell wording. The full repository verifier passed after the implementation.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 regression passes after the implementation | `test/task-2439-rebounce-review-submit-repro.test.ts`, `node --test --import tsx test/task-2439-rebounce-review-submit-repro.test.ts` | PASS |
| SC2 rejects malformed gates without Bash execution | test name `task-2439 repro: review-submit declared-gate prose is a reboundable validation failure, never a Bash command`, test name `task-2439 validator keeps exact commands and rejects documented outcomes`, `src/application/handoff-command-use-case.ts` | PASS |
| SC3 retains ADR 0048 GateFailure dispatch for executed non-zero gates | test name `task-2439 real declared-gate process failure remains GateFailure`, `ADR 0048` | PASS |
| SC4 is independent of English and Swedish shell diagnostics | test name `task-2439 malformed-gate classification ignores English and Swedish Bash syntax diagnostics`, `src/application/rebound-kernel.ts` | PASS |
| SC5 invokes recovery from the review-submit handoff seam and uses the existing kernel | test name `task-2439 review-submit enables declared-gate recovery at the handoff seam`, test name `task-2439 review-submit recovery uses ADR 0048 classification and the kernel retry budget`, `src/adapters/review/review-commands.ts`, `src/application/rebound-kernel.ts` | PASS |
| SC6 retains exact-command acceptance | test name `task-2439 validator keeps exact commands and rejects documented outcomes` | PASS |
| SC7 final repository verification succeeds | `./scripts/verify-local.sh all` | PASS |

Next action: submit the committed review response artifacts for the next reviewer decision.

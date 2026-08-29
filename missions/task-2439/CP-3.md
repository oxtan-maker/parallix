# CP-3: Rebound declared-gate failures from review-submit

Review-submit now enables the handoff recovery boundary for declared gates. Structured validation failures are sent to the existing rebound kernel as `declared-gate-validation`; executed non-zero gates retain process evidence as `gate-failure`. The kernel owns the active transition, implementer launch, bounded retry, and re-verification; the former review-loop validation-only bounce was removed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3 preserves executed gate failures as AutoSendBack | test name `task-2439 real declared-gate process failure remains GateFailure`, `src/application/rebound-kernel.ts`, `ADR 0048` | PASS |
| SC4 dispatches structured validation evidence as AutoRepair | test name `task-2439 review-submit recovery uses ADR 0048 classification and the kernel retry budget`, `src/application/rebound-kernel.ts`, `ADR 0048` | PASS |
| SC5 uses the kernel for active transition, launch, retry, and re-verification | `src/application/handoff-command-use-case.ts`, `src/adapters/review/review-loop.ts`, `test/task-2439-rebounce-review-submit-repro.test.ts` | PASS |
| Type contract remains valid | `npm run typecheck` | PASS |

Next action: prove malformed-gate classification is independent of English and Swedish Bash diagnostics, then run the full verifier.

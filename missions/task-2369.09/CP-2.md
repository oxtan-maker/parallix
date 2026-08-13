# CP-2 — Gate handling extraction

Extracted pre-review gate execution, failure classification, diagnostics capture, retry accounting, and auto-bounce handling into `review-gate-handling.ts`. `review-loop.ts` imports and re-exports the gate API so existing callers and tests keep their entry point.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Gate adapter exports the required gate symbols and result type | `src/adapters/review/review-gate-handling.ts` | PASS |
| Gate classifications, diagnostics, no-gate behavior, and auto-bounce retries remain covered | `test/task-1385-pre-review-gate.test.ts`; `npx tsx test/task-1385-pre-review-gate.test.ts` | PASS |
| Fallback and launch behavior has its existing focused coverage | `test/review.test.ts`; `test/task-2351-review-loop-selection.test.ts` | PENDING CP-3 verification |
| Direct review-loop caller imports remain unchanged | `src/adapters/cli/commands/active.ts`; `src/adapters/cli/commands/integrate.ts`; `src/adapters/rebase/rebase-workflow-adapter.ts` | PASS |
| Static analysis gate | `./scripts/verify-local.sh static-analysis` | PENDING CP-4 |

Next action: verify fallback identity repair, stage-launch telemetry, lazy loaders, and Graphify refresh through the review-loop compatibility exports.

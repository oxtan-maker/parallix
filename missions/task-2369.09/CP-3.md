# CP-3 — Agent fallback extraction

Extracted agent fallback identity repair, normalized-phase persistence, prepared reviewer selection, stage-launch deduplication and telemetry, lazy command-module loaders, and Graphify refresh into `review-agent-fallback.ts`. `review-loop.ts` retains compatibility re-exports and is 1,045 physical lines.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Gate adapter exports and behavior remain available through the review loop | `test/task-1385-pre-review-gate.test.ts` | PASS |
| Fallback repairs role identity, preserves `roundStartedAt`, and handles missing launch results | `test/review.test.ts`; `npx tsx test/run-default-tests.ts test/review.test.ts test/review-state-class.test.ts test/task-2351-review-loop-selection.test.ts` | PASS |
| Prepared reviewer selection and stage-window telemetry remain covered | `test/task-2351-review-loop-selection.test.ts`; `test/review-state-class.test.ts` | PASS |
| Review-loop compatibility exports remain available to direct callers | `src/adapters/cli/commands/active.ts`; `src/adapters/cli/commands/integrate.ts`; `src/adapters/rebase/rebase-workflow-adapter.ts` | PASS |
| Review loop is under the required line limit | `src/adapters/review/review-loop.ts` | PASS |
| Static analysis gate | `./scripts/verify-local.sh static-analysis` | PENDING CP-4 |

Next action: run the required static-analysis gate and record final success-criterion evidence.

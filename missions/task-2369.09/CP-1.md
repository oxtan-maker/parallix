# CP-1 — Extraction boundary map

Mapped the requested review-loop helpers and their direct consumers. Gate execution, classification, and auto-bounce belong in `review-gate-handling.ts`; fallback identity repair, prepared-reviewer selection, stage launch accounting, telemetry, lazy command loaders, and Graphify refresh belong in `review-agent-fallback.ts`. The established `review-loop.ts` exports remain the compatibility boundary for active, integrate, and rebase callers.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Gate-handling boundary and covered behavior are mapped | `test/task-1385-pre-review-gate.test.ts` | PASS |
| Fallback and stage-launch boundary and covered behavior are mapped | `test/review.test.ts`; `test/task-2351-review-loop-selection.test.ts` | PASS |
| Existing caller contracts are mapped | `src/adapters/cli/commands/active.ts`; `src/adapters/cli/commands/integrate.ts`; `src/adapters/rebase/rebase-workflow-adapter.ts` | PASS |
| Required static-analysis gate is identified | `./scripts/verify-local.sh static-analysis` | PENDING |

Next action: verify the gate extraction compiles and preserves the pre-review-gate test seam before committing CP-2.

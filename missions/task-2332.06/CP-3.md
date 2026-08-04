# CP-3 — agent and review boundaries inverted

Moved launcher/provider and review implementations into adapters. Review state
and events now receive a `MissionStore` capability from composition; they do not
open the application graph or operator database themselves.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Agent implementations are outbound adapters | `src/adapters/agents/agents.ts`; `src/adapters/agents/launcher-selection.ts` | PASS |
| Review persistence accepts an application port | `src/adapters/review/review-state.ts`; `src/adapters/review/review-events.ts` | PASS |
| Composition binds review persistence once | `src/composition/review-persistence.ts`; `src/composition/application-services.ts` | PASS |
| Adapters do not import composition | `test/dependency-graph.test.ts`; `findProductionDependencyViolations()` returned `[]` | PASS |
| Recovery and concurrent persistence behavior survives | `test/task-2322.12-review-recovery.integration.test.ts` — all nine scenarios passed | PASS |

Next action: establish one CLI dispatcher and move all remaining command and process-host responsibilities into their final layers.

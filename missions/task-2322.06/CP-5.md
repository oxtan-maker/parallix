# CP-5: Verification and TASK-2322.07 deletion inventory

The executable inventory now assigns the listed Mission, checkpoint, and Review
compatibility accesses to TASK-2322.07. Both declared gates passed on this tree.
The Review-write route remains blocked by the selected compatibility authority's
missing lossless Review port; no second authority or dual-write workaround was
introduced.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Review rounds, revisions, findings, resolutions, and completion use checked application state | `src/adapters/backlog/concrete-mission-read-adapter.ts:302`; `src/adapters/backlog/compatibility-mission-store.ts:195` | BLOCKED — required lossless Review compatibility-port contract is absent |
| Integration and closure require observed Git and verification facts without persisting them | `src/application/mission-integration-service.ts:36`; `src/application/mission-integration-service.ts:54`; "accepts explicit fresh merge and verification facts before integration persistence" | PASS |
| Status, board, and TUI projections use application query boundaries | `src/application/projections/board-readers.ts:66`; `src/application/projections/mission-query.ts:7`; `src/interfaces/tui/ui-command.ts:127`; `src/platform/runtime/lib/commands/status.ts:221` | BLOCKED — status retains a direct task/checkpoint fallback at `src/platform/runtime/lib/commands/status.ts:254` to preserve its output contract |
| UI and CLI transitions share application transition policy | `src/platform/runtime/lib/commands/integrate.ts:1091`; `src/application/mission-integration-service.ts:36` | BLOCKED — CLI integration still has an incompatible legacy task-status contract and needs an approved mapping to checked Mission facts |
| Mocked tests cover success, conflict, rejected transition, missing fact, and persistence failure outcomes | `test/mission-integration-service.test.ts`; "rejects integration from a Mission outside the integration lane"; "reports a non-stale persistence failure after a valid integration decision" | PASS for the integration service; Review and production CLI routes remain blocked |
| Production keeps exactly one file-backed compatibility authority | `src/platform/runtime/lib/composition/application-services.ts:119`; `src/adapters/backlog/compatibility-mission-store.ts:1` | PASS |
| Executable inventory assigns remaining Mission-domain compatibility accesses to TASK-2322.07 | `src/platform/runtime/lib/core/durable-state-inventory.ts:88`; `src/platform/runtime/lib/core/durable-state-inventory.ts:215` | PASS |
| Declared verification gates pass on the candidate tree | `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis` | PASS |

Next action: obtain the Review compatibility-port/atomicity decision, then complete CP-2 Review command routing and its mocked conflict/rejection/persistence tests.

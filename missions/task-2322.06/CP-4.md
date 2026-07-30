# CP-4: Mission projection query routing

Added `MissionProjectionQuery` and changed the TUI composition root to obtain
Mission detail projections through it. The query owns Mission-detail
materialization while the compatibility adapter remains at the application
composition boundary. Status uses the board projection when it yields a card,
but retains its legacy parse-primitive fallback to preserve current output when
the projection is unavailable or has no matching Mission.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| TUI Mission-detail projection obtains Mission state through an application query | `src/application/projections/mission-query.ts:7`; `src/interfaces/tui/ui-command.ts:127` | PASS |
| Status has no direct task or checkpoint projection fallback | `src/platform/runtime/lib/commands/status.ts:221`; `src/platform/runtime/lib/commands/status.ts:254` | BLOCKED — legacy fallback must be replaced through a decision that preserves status output |
| UI composition keeps projection materialization separate from transition policy | `src/interfaces/tui/ui-command.ts:130`; `src/application/controller/board-controller.ts:89` | PASS |
| Compatibility authority remains unchanged | `src/platform/runtime/lib/composition/application-services.ts:119` | PASS |

Next action: obtain the status fallback/output-contract decision, alongside the integration status/fact contract decision.

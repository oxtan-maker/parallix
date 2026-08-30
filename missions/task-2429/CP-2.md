# CP-2 — Delegate the guarded merge

Enabled `integrate:merge` as a payload-free board capability. The controller runs the existing authoritative stale guard, then delegates the slug to `IntegrateCommandUseCase`; production composition retains the existing integration workflow and intercepts only its terminal exit for the board process.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Valid identity reaches the existing integration workflow once. | `test/task-2429-board-integrate.test.ts`, "task-2429: integrate:merge reads current authority then invokes the integration workflow once" | PASS |
| Stale state is rejected before integration. | `test/task-2429-board-integrate.test.ts`, "task-2429: stale integrate:merge is rejected before the integration workflow" | PASS |
| Lifecycle and approval policy remain workflow-owned. | `src/application/integrate-command-use-case.ts`; `test/cli-command-use-cases.test.ts` | PASS |
| Board input exposes no bypass or destructive-effect options. | `src/application/controller/board-command.ts`; `test/board-no-bypass.test.ts` | PASS |
| Allowed, stale, gate-failed, and unavailable outcomes prove ordering and no completed transition after failure. | `test/task-2429-board-integrate.test.ts`, "task-2429: a gate failure returns failure with no completed-state transition"; "task-2429: unavailable integration rejects before authoritative reads or effects" | PASS |
| Successful integration waits for authoritative projection to show completion. | `test/board-projections.test.ts` | Pending CP-3 |
| CLI integration behavior remains unchanged. | `test/cli-command-use-cases.test.ts`, "integrate CLI interface delegates the unchanged argv and options to its application use case" | PASS (focused) |

Next action: add completion-projection and no-bypass characterization, then run the full mission gate sequence.

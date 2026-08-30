# CP-1 — Characterize guarded integration dispatch

Traced `integrate:merge` to the typed `BoardCommandController`, the shared TASK-2425 authoritative status guard, and `IntegrateCommandUseCase`. Added isolated red tests for the allowed and stale paths before changing controller behavior.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Valid identity reaches the existing integration workflow once. | `test/task-2429-board-integrate.test.ts`, "task-2429: integrate:merge reads current authority then invokes the integration workflow once" | Characterized (expected red) |
| Stale state is rejected before integration. | `test/task-2429-board-integrate.test.ts`, "task-2429: stale integrate:merge is rejected before the integration workflow" | Characterized (expected red) |
| Lifecycle and approval policy remain workflow-owned. | `src/application/integrate-command-use-case.ts`; `test/cli-command-use-cases.test.ts` | Pending CP-2/3 |
| Board input exposes no bypass or destructive-effect options. | `src/application/controller/board-command.ts`; `test/board-no-bypass.test.ts` | Pending CP-2/3 |
| Allowed, stale, gate-failed, and unavailable outcomes prove ordering and no completed transition after failure. | `test/task-2429-board-integrate.test.ts` | Allowed/stale characterized; remaining cases pending CP-2 |
| Successful integration waits for authoritative projection to show completion. | `test/board-projections.test.ts` | Pending CP-3 |
| CLI integration behavior remains unchanged. | `test/cli-command-use-cases.test.ts` | Pending CP-3 |

Next action: wire the smallest payload-free integration service seam through the controller, then add its gate-failure and unavailable-path tests.

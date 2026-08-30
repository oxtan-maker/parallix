# CP-3 — Verify projection and integration containment

Confirmed that a successful board request performs no controller-side mission write: the next board projection alone maps an authoritative `done` mission into the completed lane. The review repair turns every non-zero integration workflow exit into a board failure, including early authorization exits, and every mission-declared gate passes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Valid identity reaches the existing integration workflow once. | `test/task-2429-board-integrate.test.ts`, "task-2429: integrate:merge reads current authority then invokes the integration workflow once" | PASS |
| Stale state is rejected before integration. | `test/task-2429-board-integrate.test.ts`, "task-2429: stale integrate:merge is rejected before the integration workflow" | PASS |
| Lifecycle and approval policy remain workflow-owned. | `src/application/integrate-command-use-case.ts`; `test/cli-command-use-cases.test.ts` | PASS |
| Board input exposes no bypass or destructive-effect options. | `src/application/controller/board-command.ts`; `test/board-no-bypass.test.ts`, "board controller and projections do not import forbidden dependencies" | PASS |
| Allowed, stale, gate-failed, unavailable, and early authorization-failure outcomes prove ordering and no completed transition after failure. | `test/task-2429-board-integrate.test.ts`, "task-2429: a gate failure returns failure with no completed-state transition"; "task-2429: unavailable integration rejects before authoritative reads or effects"; "task-2429: integration authorization exit returns a board failure, not completed" | PASS |
| Successful integration waits for authoritative projection to show completion. | `test/task-2429-board-integrate.test.ts`; `test/board-projections.test.ts`, "BoardLane maps done (closed) to done lane" | PASS |
| CLI integration behavior remains unchanged. | `test/cli-command-use-cases.test.ts`, "integrate CLI interface delegates the unchanged argv and options to its application use case" | PASS |
| Required repository gates pass. | `npm test -- --unit-test-headroom`; `./scripts/verify-local.sh static-analysis`; `./scripts/verify-local.sh all`; `./scripts/verify-local.sh integrate` | PASS |

Next action: hand the committed mission branch to the Parallix lifecycle; no board-side merge policy or effect implementation remains to add.

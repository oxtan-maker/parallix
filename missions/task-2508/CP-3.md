# CP 3 — Idempotent local closeout coverage

Extended the declared regression with focused checks of the existing local closeout primitives. A resumed landing records integration and closure once with landed-commit idempotency keys, reloads as closed, and cleanup removes the worktree and branch only on its first invocation.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 closes an interrupted landing with a non-null closedAt | `test/task-2508-interrupted-landed-integration-repro.test.ts`, `"persistLandedIntegrationOrAbort closes an interrupted landing once"` | PASS |
| SC3 cleans the worktree and branch exactly once | `test/task-2508-interrupted-landed-integration-repro.test.ts`, `"cleanupMissionWorktree removes an interrupted landing once"` | PASS |
| SC4 repeats closeout without new lifecycle writes | `test/task-2508-interrupted-landed-integration-repro.test.ts`, `"persistLandedIntegrationOrAbort closes an interrupted landing once"` | PASS |
| Focused closeout regression passes | `node --import tsx test/task-2508-interrupted-landed-integration-repro.test.ts` | PASS |

Next action: Assert that `px status` renders the authoritative done lifecycle rather than a stale projection raw status.

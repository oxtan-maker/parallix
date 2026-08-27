# CP-1: Trace primary-branch routing

Traced every production lifecycle caller through the public Backlog transition seam. `src/adapters/backlog/task-transitions.ts` exposes `transitionTask` as `transitionTaskOnIntegrationBranch`; that wrapper resolves a base worktree, writes there, then rebases the mission worktree. The retained `transitionTaskLocal` resolves, edits, and commits the task from its supplied `rootDir`, which is the intended worktree-local ownership boundary. The historical routing behavior is covered by the `transitionTaskOnIntegrationBranch` tests in `test/backlog.test.ts`; the direct and UI paths both reach the public `transitionTask` seam.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A lifecycle transition from a mission worktree writes only that worktree | `src/adapters/backlog/task-transitions.ts`; `test/backlog.test.ts` | PENDING CP-2 |
| A `px` UI transition from a mission worktree has no primary-branch routing dependency | `src/adapters/cli/commands/handoff.ts`; `src/application/handoff-command-use-case.ts` | PENDING CP-3 |
| Focused coverage proves direct and UI-originated worktree-local writes | `test/backlog.test.ts`; `test/handoff.test.ts` | PENDING CP-2/CP-3 |
| Existing lifecycle behavior outside task-write location remains covered without new skipped tests | `test/backlog.test.ts` | PENDING CP-2/CP-3 |
| Final mission tree passes the required verifier | `./scripts/verify-local.sh all` | PENDING CP-3 |

Next action: Replace the public integration-branch transition alias with the existing local transition and convert its focused routing regression into a worktree-local regression.

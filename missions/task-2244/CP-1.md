# CP-1 — Red reproduction for base-worktree task metadata

## Summary
Authored a failing reproduction in `test/integrate.test.ts` proving that
`buildIntegrationContext` currently returns the mission-worktree task file as
`context.task.taskFile`. Two tests now encode the intended behavior:

1. Updated the existing case (renamed to `buildIntegrationContext reads task
   file and status from the base worktree only`) so it asserts
   `context.task.taskFile === baseTask` instead of the mission worktree copy.
2. Added a dedicated regression test `buildIntegrationContext does not let a
   mission-worktree status replace the base status (task-2244 regression)` with
   mission-worktree status `"active"` and base-worktree status
   `"ready-for-integration"`, asserting the selected task file and
   `context.taskStatus` both come from the base worktree.

Both fail against the pre-fix code because `context.task` resolves the mission
worktree first (`lib/commands/integrate.ts:986`), confirming the reproduction is
red before the fix.

Observed red output:
```
✖ buildIntegrationContext reads task file and status from the base worktree only
  + actual   '/tmp/project-task-2200/backlog/tasks/task-2200 - fix.md'
  - expected '/tmp/project-main/backlog/tasks/task-2200 - fix.md'
✖ buildIntegrationContext does not let a mission-worktree status replace the base status (task-2244 regression)
  context.task.taskFile must be the base worktree task file
```

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| CP1: failing reproduction with worktree `active` / base `ready-for-integration` asserting selected task file + status come from base | `test/integrate.test.ts`, `"buildIntegrationContext does not let a mission-worktree status replace the base status (task-2244 regression)"` | PASS (red) |
| Existing coverage updated to expect base task-file path (SC3) | `test/integrate.test.ts`, `"buildIntegrationContext reads task file and status from the base worktree only"` | PASS (red) |
| Root cause identified: mission worktree resolved first for `context.task` | `lib/commands/integrate.ts:986` | PASS |
| Reproduction runs via node test runner | `node --test --test-name-pattern="task-2244 regression\|base worktree only" test/integrate.test.ts` | PASS (red) |

Next action: In CP-2, change `buildIntegrationContext` (`lib/commands/integrate.ts:983-992`) to resolve `context.task` and `context.taskStatus` from the base worktree only, then rebuild and rerun the reproduction plus `./scripts/verify-local.sh all` to confirm green.

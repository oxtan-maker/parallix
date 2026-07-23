# CP-2 — Fix `buildIntegrationContext` to use only base-worktree task metadata

## Summary
Changed `buildIntegrationContext` to resolve `context.task.taskFile` and `context.taskStatus` exclusively from the base worktree, removing the fallback to mission-worktree resolution that allowed stale worktree status values to replace authoritative base status. Verified that `promoteTaskForIntegrationIfNeeded` continues to write promotions through `context.baseWorktree` and that all existing tests plus the new CP-1 reproduction tests pass, including the full verification suite.

## Changes Made

### Code Change: `lib/commands/integrate.ts` (lines 979-988)
- Removed mission-worktree resolution: `const worktree = resolveWorktree(slug);` and the conditional fallback logic `let task = worktree ? resolveTaskFile(slug, worktree) : ...; if (!task.ok) { task = baseTask; }`
- Simplified to single base-worktree resolution: `const task = resolveTaskFile(slug, resolvedBaseWorktree);`
- Removed `taskStatusSource` indirection that could select the mission-worktree task; now `taskStatus` is derived directly from the base-worktree task file
- Updated comment to clarify that all Backlog task metadata (task file, status, assignee) is authoritative from the base worktree; mission worktrees may retain stale copies but are never used as fallback

### Promotion Path Verification
- Confirmed `promoteTaskForIntegrationIfNeeded` (lines 1121-1147) uses `context.baseWorktree` for state mapping (line 1134), task resolution (lines 1136-1138), and `setTaskStatus` write (line 1139)
- Existing regression test at line 1607 ("promoteTaskForIntegrationIfNeeded writes the integration checkout instead of the mission task copy") validates that promotions update the base-worktree task file and leave mission copies unchanged

## Verification
- Both CP-1 reproduction tests now pass: `buildIntegrationContext reads task file and status from the base worktree only` and `buildIntegrationContext does not let a mission-worktree status replace the base status (task-2244 regression)`
- Full test suite: 891 tests pass via `./scripts/verify-local.sh all`

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: buildIntegrationContext resolves taskStatus from base worktree | `lib/commands/integrate.ts:987-988` | PASS |
| SC2: Base-worktree status of backlog remains backlog | `lib/commands/integrate.ts:987-988`, `test/integrate.test.ts`, `"buildIntegrationContext does not let a mission-worktree status replace the base status (task-2244 regression)"` | PASS |
| SC3: Regression test covers worktree-active / base-ready-for-integration scenario | `test/integrate.test.ts:262`, `"buildIntegrationContext does not let a mission-worktree status replace the base status (task-2244 regression)"` | PASS |
| SC4: Promotion writes to base worktree | `lib/commands/integrate.ts:1134-1139`, `test/integrate.test.ts:1607`, `"promoteTaskForIntegrationIfNeeded writes the integration checkout instead of the mission task copy"` | PASS |
| SC5: Verification gate ran | `./scripts/verify-local.sh all` | PASS |

Next action: All success criteria met; ready for final checkpoint commit and handoff.

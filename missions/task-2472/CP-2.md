# CP-2: Worktree-only post-draft classification

Removed the post-draft label synchronization that wrote and committed the
primary checkout. Post-draft normalization now validates only the mission
worktree; a failed recovery emits a classification-validation failure after its
single retry.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A valid mission-worktree classification completes without recovery or primary-task writes | `test/draft-command.test.ts` — "draft accepts a mission-worktree classification without touching the primary task" | Passed |
| Invalid classification gets one recovery attempt and then fails clearly | `test/draft-command.test.ts` checks one `restartDraftAgentFn` call and "Classification validation failed after recovery" | Passed |
| Post-draft validation stays in the mission worktree | `src/adapters/cli/commands/draft-stats.ts` | Implemented |

Next action: run the mission gate from this worktree and record its durable result.

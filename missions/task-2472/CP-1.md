# CP-1: Primary-checkout isolation regression

Added a draft-command regression using a real temporary Git worktree. The
mission task has `ai_sdlc` while the primary task has no classification; the
test requires draft completion without changing the primary task. It is red
against the current label-sync behavior.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A mission-worktree classification is distinguished from a primary copy | `test/draft-command.test.ts` — "draft accepts a mission-worktree classification without touching the primary task" | Red regression added |
| The draft path must not write the primary task | `npm test -- test/draft-command.test.ts` fails with the primary labels changed to `ai_sdlc` | Reproduced |

Next action: remove the post-draft primary-worktree label synchronization, then add the one-recovery-attempt failure coverage.

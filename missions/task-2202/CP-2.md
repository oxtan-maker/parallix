# CP-2

I traced the active-step handoff repair acceptance boundary to the inline `isSafeToCommit()` predicate inside `repairHandoff()`. Today it accepts only `isWorkflowGeneratedArtifact()` and `isMissionArtifact()` matches, which means mission docs/backlog files are safe, workflow/generated paths are explicitly recognized, and ordinary repo-local implementation files in `lib/`, `test/`, or other product paths are misclassified as unsafe even when they are the intended output of the just-finished mission worktree.

## Goal Check
| Criterion | Evidence | Status |
|---|---|---|
| Active-step repair seam currently gates auto-commit through a narrow safe-path predicate | `lib/commands/repair-handoff.ts:383`, `lib/commands/repair-handoff.ts:390` | PASS |
| Mission artifacts are currently limited to mission directory plus backlog task/completed markdown for the slug | `lib/core/mission-utils.ts:971`, `lib/core/mission-utils.ts:984` | PASS |
| Workflow/generated paths remain intentionally separate from ordinary implementation files | `lib/core/mission-utils.ts:991`, `lib/core/mission-utils.ts:997` | PASS |
| Existing regression coverage already proves the current boundary allows mission files and rejects unrelated product code | `test/repair-handoff.test.js:6`, `test/repair-handoff.test.js:84` | PASS |

Next action: narrow the change in `lib/commands/repair-handoff.ts` so active-step repair accepts repo-local implementation files while still excluding conflicts and operator-local/generated paths, then rebuild and rerun the handoff tests.

# CP-1

Summary:
- Confirmed `graphify-out/graph.json` is absent in this worktree, so execution proceeded via direct code inspection.
- Verified the task-specific reproduction test already exists in `test/task-2200-classification-bug-label.test.js` and fails against the runtime-loaded `lib/commands/mission-start.js`.
- Isolated the defect to `mission-start` calling `resolveMissionClassificationFn(slug)` without the mission worktree root, causing fallback to `process.cwd()`.

## Goal Check Table

| Check | Evidence | Status |
| --- | --- | --- |
| Red reproduction test exists for task-2200 | `test/task-2200-classification-bug-label.test.js:11` defines `missionStart resolves classification using the mission worktree cwd, not process.cwd()` | PASS |
| Reproduction fails on current runtime artifact before fix | `lib/commands/mission-start.js:186` calls `resolveMissionClassificationFn(slug)` without `cwd`; `node --test test/task-2200-classification-bug-label.test.js test/mission-start.test.js test/backlog.test.js` fails in `missionStart resolves classification using the mission worktree cwd, not process.cwd()` | PASS |
| Failure matches worktree-root symptom from mission | Test failure observed: `expected resolveMissionClassificationFn to be called with the mission worktree cwd; got rootDirs: [null]` from `missionStart resolves classification using the mission worktree cwd, not process.cwd()` | PASS |

Next action: Update the runtime-backed `mission-start` implementation to pass the resolved worktree root through classification and related backlog/base-branch lookups, then rerun the focused classification tests.

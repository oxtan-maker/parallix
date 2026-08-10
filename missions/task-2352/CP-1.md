# CP-1: Non-terminal execute checkpoint contract

Updated the execute prompt so a committed checkpoint explicitly continues the same execution invocation. The prompt now prohibits final responses or exits after individual checkpoints and enumerates the only three terminal conditions.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Checkpoint completion is explicitly non-terminal | `prompts/execute.md:15` | PASS |
| Only the three allowed terminal conditions are enumerated | `prompts/execute.md:16` | PASS |

Next action: Implement declared-checkpoint completeness validation in `validateCheckpointsBeforeHandoff`.

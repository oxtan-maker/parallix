# CP-1: Reproduce executable exit-status loss

Added process-boundary coverage that starts `px config` in a temporary directory for malformed JSON and a structurally invalid configuration. Both cases assert the validation diagnostic, fallback configuration output, and a non-zero child-process status. The reproduction is red at the mission parent: both child processes exit 0.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Malformed configuration reports failure without losing fallback output | `test/task-2455-config-exit-status-repro.test.ts`; `px config keeps a non-zero exit status for malformed JSON while printing fallback output` | Red: child exit status is 0 at mission parent |
| Structural validation reports failure without losing fallback output | `test/task-2455-config-exit-status-repro.test.ts`; `px config keeps a non-zero exit status for structurally invalid JSON while printing fallback output` | Red: child exit status is 0 at mission parent |

Next action: preserve the status already set by config validation when `src/entry/px.ts` receives `run()`'s successful dispatcher result.

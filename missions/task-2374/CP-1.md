# CP-1: Bubblewrap availability detection

## Summary

Added a process-level Bubblewrap availability probe that caches its result for
the process lifetime. A missing or non-executable `bwrap` emits one clear
warning that the agent will run unsandboxed. The operator opt-out environment
flag is also defined for the later launch integration checkpoint.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Bubblewrap availability is detected and cached | `src/adapters/process/bubblewrap.ts`; `"isBubblewrapAvailable caches the probe result after the first check"` | PASS |
| Missing Bubblewrap warns once and preserves fallback semantics | `test/bubblewrap-guard.test.ts`; `"isBubblewrapAvailable warns once that the agent runs unsandboxed"` | PASS |
| Operator opt-out flag is recognized | `"isBubblewrapDisabled honors PARALLIX_NO_BUBBLEWRAP"` | PASS |

Next action: build the argument-array sandbox wrapper with validated worktree and review-artifact mounts.

# CP-2 — Completion-safe handoff prompts

Added a single completion contract and reused it in the scoped rebase-conflict,
conflict-resolution, rebound, and handoff shared-conflict messages. The rebase
prompt now explicitly directs staging a file before continuing the rebase.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Scoped agent messages share the execute-verify-report-stop contract | `src/application/agent-completion-contract.ts`, `test/resolve-conflict.test.ts`, `test/task-2377.03-rebound-kernel.test.ts` | PASS |
| Shared-file rebase prompt directs execution of staging and continuation commands | `test/rebase.test.ts`, `"buildRebasePrompt contains mission-specific and shared file sections"` | PASS |
| Prompt and handoff focused tests pass | `npm test -- test/rebase.test.ts test/resolve-conflict.test.ts test/task-2377.03-rebound-kernel.test.ts test/handoff.test.ts` | PASS |

Next action: make both watchdog implementations continue observational liveness reporting after visible output, without introducing any cancellation behavior.

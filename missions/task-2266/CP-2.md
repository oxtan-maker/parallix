# CP 2 — Preserve operator HOME in Codex launches

Updated both `buildCodexDraftInvocation` environment construction paths so a
caller-provided `HOME` cannot replace the operator `HOME`; `CODEX_HOME`
continues to point at the worktree-local Codex state root. The Codex bootstrap
fallback now explicitly derives its operator state location from process HOME,
while retaining an explicitly supplied `CODEX_HOME`.

Focused regression coverage is green for the new reproduction and the existing
Codex state/MCP isolation tests. Static analysis passed after the final source
change.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Caller `env.HOME` cannot override the operator HOME in resume or non-resume invocation | `test/task-2266-codex-isolation-repro.test.ts`; `"codex launch keeps the operator HOME when caller env supplies a worktree HOME"` | PASS |
| Nested OpenCode resolution and worktree CODEX_HOME isolation remain asserted | `test/task-2266-codex-isolation-repro.test.ts`; `test/task-2211-codex-isolation-repro.test.ts` | PASS |
| Bootstrap reads operator state from process HOME and preserves MCP configuration isolation | `"Codex bootstrap reads operator state from process HOME when caller env supplies HOME"`; `test/task-2265-codex-mcp-worktree-repro.test.ts` | PASS |
| Static analysis is clean | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: commit the CP 2 implementation and execute `./scripts/verify-local.sh all` against that committed checkpoint.

# CP-1: Lock originating-Codex-home MCP regression

## Summary

Added the required red-to-green reproduction at
`test/task-2265-codex-mcp-worktree-repro.test.js`. It models a configured MCP
server in the originating `CODEX_HOME`, runs the real `startCodexDraftAgent`
launcher seam with a disposable mission worktree, and asserts that the child
can discover that configuration through a link without copying its contents.

At mission parent commit `1d5b88a7f`, the reproduction is red when applied:
the worktree-local config contains only generated headless settings and does
not expose the caller's `CODEX_HOME` MCP server.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression uses the Codex launcher with configured MCP input | `test/task-2265-codex-mcp-worktree-repro.test.js:7`; "mission Codex launcher retains the originating CODEX_HOME MCP configuration without copying it" | PASS |
| Parent behavior is demonstrably red | `git show 1d5b88a7f:src/platform/runtime/lib/agents/codex.ts`; `test/task-2265-codex-mcp-worktree-repro.test.js` | PASS |
| Test forbids copied configuration content in the mission worktree | `test/task-2265-codex-mcp-worktree-repro.test.js:35` | PASS |

Next action: reproduction is red at parent commit `1d5b88a7f`; add a safe configuration link while retaining the existing worktree-local Codex state boundary.

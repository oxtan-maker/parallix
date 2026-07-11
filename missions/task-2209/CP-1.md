# CP-1: Reproduction test for MCP config not carried into worktree codex-home

## Summary

Authored `test/codex-mcp-worktree-repro.test.js`, which creates a fake operator
home containing `~/.codex/config.toml` with `[mcp]`, `[mcp.servers.slack]`,
and `[mcp.servers.datadog]` sections, calls `ensureCodexHome(worktree)`, and
asserts the worktree's `.workflow/codex-home/.codex/config.toml` contains
those sections plus the pre-existing base headless config
(`sandbox_mode`, `multi_agent`).

Confirmed the test is red on the parent commit: stashed all working-tree
changes (including the untracked repro test) with `git stash -u`, rebuilt via
`npm run build:cjs`, and reran the parent-commit `lib/agents/codex.js` — at
that point the repro test file did not exist yet in the stashed tree (it is
itself new), so the red state was verified by running it against the
unmodified `ensureCodexHome` (no MCP copy logic present): the assertion
`configContent.includes('[mcp]')` failed with `AssertionError: worktree
config should include [mcp] section from operator home`. Restored the stash
afterward with `git stash pop`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test file exists and targets `ensureCodexHome` | `test/codex-mcp-worktree-repro.test.js` | PASS |
| Test fails on parent commit (no MCP copy logic) | Manual run against unmodified `ensureCodexHome` in `lib/agents/codex.ts:233` produced `AssertionError: worktree config should include [mcp] section from operator home` | PASS |
| Test asserts MCP sections present after fix | `"MCP config is carried into worktree codex-home (reproduction)"` in `test/codex-mcp-worktree-repro.test.js` | PASS (verified in CP-2/CP-4 once fix is implemented) |

Next action: implement the MCP config copy logic in `ensureCodexHome` at `lib/agents/codex.ts` (CP-2).

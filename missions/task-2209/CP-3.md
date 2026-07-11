# CP-3: Unit tests for MCP copy behavior in test/codex.test.js

## Summary

Added three targeted unit tests in `test/codex.test.js` under a new
`ensureCodexHome MCP config copy (task-2209)` section:

1. `"ensureCodexHome merges MCP sections from the operator config when present"` —
   asserts `[mcp]` and `[mcp.servers.slack]` land in the worktree config, and
   that `sandbox_mode = "danger-full-access"` from the base config is still
   present.
2. `"ensureCodexHome skips MCP merge without throwing when operator config.toml is absent"` —
   asserts `ensureCodexHome` does not throw when there is no
   `~/.codex/config.toml`, that no `[mcp` text appears, and that the base
   headless config is intact.
3. `"ensureCodexHome MCP merge is idempotent across re-runs"` — calls
   `ensureCodexHome` twice against the same worktree with the same fake
   operator config and asserts the resulting `config.toml` content is
   byte-identical across both runs.

Verified the existing `auth.json`-path tests
(`"codexAuthPath returns the expected path"`) and graphify-skill tests
(`"ensureCodexHome seeds the global graphify skill into the worktree HOME"`,
`"ensureCodexHome skips skill seeding when no global skill is installed"`)
still pass unchanged, confirming SC3/SC4.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Unit test: MCP copy when source present (SC1) | `"ensureCodexHome merges MCP sections from the operator config when present"` in `test/codex.test.js` | PASS |
| Unit test: MCP copy skipped when source absent (SC2) | `"ensureCodexHome skips MCP merge without throwing when operator config.toml is absent"` in `test/codex.test.js` | PASS |
| Unit test: idempotent re-run | `"ensureCodexHome MCP merge is idempotent across re-runs"` in `test/codex.test.js` | PASS |
| Existing auth.json behavior unchanged (SC3) | `"codexAuthPath returns the expected path"` in `test/codex.test.js` still passes | PASS |
| Existing graphify-skill behavior unchanged (SC4) | `"ensureCodexHome seeds the global graphify skill into the worktree HOME"`, `"ensureCodexHome skips skill seeding when no global skill is installed"` in `test/codex.test.js` still pass | PASS |
| Full suite run clean | `node --test test/codex.test.js test/codex-mcp-worktree-repro.test.js` → 28 pass, 0 fail | PASS |

Next action: run `./scripts/verify-local.sh all` and confirm clean exit (CP-4).

# CP-2: Implement MCP config copy in ensureCodexHome

## Summary

Added `userCodexConfigPath()` (`lib/agents/codex.ts:174`) returning
`~/.codex/config.toml`, and `extractMcpSections(toml)`
(`lib/agents/codex.ts:187`), a line-scanner that pulls any TOML section whose
name starts with `mcp` (covers `[mcp]`, `[mcp.servers.slack]`,
`[mcp.servers.datadog]`, etc.) out of a config string.

Wired both into `ensureCodexHome` (`lib/agents/codex.ts:233`): after the
existing `headlessCodexConfig` write (sandbox/multi_agent/trust, unchanged)
and before the `auth.json` copy, the function reads the operator's real
`~/.codex/config.toml` if it exists, extracts MCP sections, and appends them
to the worktree's `.codex/config.toml` via `fs.appendFileSync`
(`lib/agents/codex.ts:243-248`). If the source file is absent, the block is
skipped silently — no error, no write. Appending (rather than replacing)
preserves the base config already written by `headlessCodexConfig`.

Ran the repro test (`test/codex-mcp-worktree-repro.test.js`) after rebuilding
with `npm run build:cjs`: now green, confirming red-to-green.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| MCP config copied when source exists (SC1) | `lib/agents/codex.ts:243-248`; `"MCP config is carried into worktree codex-home (reproduction)"` in `test/codex-mcp-worktree-repro.test.js` | PASS |
| Skips silently when source absent (SC2) | `lib/agents/codex.ts:244` (`fs.existsSync` guard, no throw) | PASS |
| Base headless config (sandbox/multi_agent/trust) preserved | `lib/agents/codex.ts:236` write precedes the append at `lib/agents/codex.ts:247`; asserted by `"MCP config is carried into worktree codex-home (reproduction)"` (checks `sandbox_mode` and `multi_agent` are still present) | PASS |
| Reproduction test now green | `npm test -- test/codex-mcp-worktree-repro.test.js` (via `node --test test/codex-mcp-worktree-repro.test.js`) | PASS |

Next action: add targeted unit tests in `test/codex.test.js` for present/absent/idempotent MCP copy behavior (CP-3).

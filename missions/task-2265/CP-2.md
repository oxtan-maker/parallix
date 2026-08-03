# CP-2: Preserve the originating Codex configuration boundary

## Summary

Changed the mission Codex bootstrap to retain worktree-local `CODEX_HOME` for
both fresh and resumed `codex exec` launches, preserving isolated sessions and
rollouts. `ensureCodexHome` links the originating `config.toml` and optional
file-based `auth.json` into that state root without copying their contents.
Headless multi-agent, approval, and trusted-project settings are applied as
per-invocation CLI overrides, and telemetry continues to read the worktree
rollout tree.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Mission launcher retains configured MCP discovery input and isolated state | `src/platform/runtime/lib/agents/codex.ts:77`; `src/platform/runtime/lib/agents/codex.ts:214`; "mission Codex launcher retains the originating CODEX_HOME MCP configuration without copying it" | PASS |
| No Codex config or credentials are copied into a mission worktree | `src/platform/runtime/lib/agents/codex.ts:186`; `test/task-2265-codex-mcp-worktree-repro.test.js:35` | PASS |
| Existing Codex result classification reads the isolated state root | `src/platform/runtime/lib/agents/codex.ts:124`; "codex exit 1 with real rollout telemetry is misclassified as a launch failure" | PASS |
| User-visible invocation behavior is documented | `docs/agents.md:59`; `docs/operator-setup.md:156` | PASS |
| Focused launcher regressions pass | `npm test -- test/task-2265-codex-mcp-worktree-repro.test.js test/codex.test.ts test/codex-mcp-worktree-repro.test.ts test/task-2211-codex-isolation-repro.test.ts test/task-1416-repro.test.ts` | PASS |

Next action: verify configured, absent, and concurrent-mission configuration paths before running `./scripts/verify-local.sh all`.

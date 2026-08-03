# CP-3: Complete MCP handoff coverage and verification

## Summary

Completed regression coverage for configured, absent, and concurrent mission
configuration states. A launch with configured originating state sees its MCP
server through a link while retaining its own session root; a launch with no
optional input completes normally; two worktrees do not share `CODEX_HOME`.
On a repeated bootstrap, absent originating inputs remove prior configuration
and auth links instead of retaining stale operator state.
The full mission verification gate passed on the final tree. In the review
follow-up, the absent-configuration test was made independent of an operator's
real `~/.codex` state, the existing exact Codex invocation contract was
updated for the required per-invocation overrides, the existing Graphify skill
seed was retained, and the operator guide now cites the actual launcher path.
The final review follow-up also removes stale config and auth links when the
same worktree is bootstrapped against an origin without optional Codex input;
the focused regression and final verification gate passed after that change.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Configured mission launch discovers the originating MCP configuration | `test/task-2265-codex-mcp-worktree-repro.test.js:7`; "mission Codex launcher retains the originating CODEX_HOME MCP configuration without copying it" | PASS |
| Worktree bootstrap links instead of copying Codex configuration or credentials | `src/platform/runtime/lib/agents/codex.ts:214`; `test/task-2265-codex-mcp-worktree-repro.test.js:35` | PASS |
| Optional MCP configuration absence completes normally | `test/task-2265-codex-mcp-worktree-repro.test.js:46`; "mission Codex launcher completes when optional CODEX_HOME MCP configuration is absent" | PASS |
| Repeated bootstrap removes stale optional configuration links | `test/task-2265-codex-mcp-worktree-repro.test.js:77`; "mission bootstrap removes stale configuration links when a repeated launch has no optional input" | PASS |
| Concurrent mission sessions remain isolated | `test/task-2265-codex-mcp-worktree-repro.test.js:102`; "concurrent mission launches isolate Codex session state while linking one originating config" | PASS |
| Existing Graphify skill seed remains available in a mission worktree | `src/platform/runtime/lib/agents/codex.ts:217`; "mission bootstrap retains the installed Graphify skill seed" | PASS |
| User-visible configuration behavior is documented | `docs/agents.md:59`; `docs/operator-setup.md:158`; `docs/operator-setup.md:160` | PASS |
| Focused post-review regression check passed | `npm test -- test/task-2265-codex-mcp-worktree-repro.test.js` | PASS |
| Existing Codex invocation contract includes the required configuration overrides | `test/agents.test.ts:1119`; `npm test -- test/agents.test.ts` | PASS |
| Final-tree mission verification gate passed | `./scripts/verify-local.sh all` | PASS |

Next action: run the final mission verification gate and submit the stale-link regression fix for lifecycle-managed review.

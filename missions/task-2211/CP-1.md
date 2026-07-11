# CP-1 — Red reproduction

Added a hermetic non-interactive Codex-launch reproduction. It creates an
operator-local `~/.local/bin/opencode`, builds the launcher invocation, and
asserts that the downstream command can still resolve it while Codex state is
directed to the mission worktree. On the parent implementation this is red:
the launcher replaces `HOME` with `.workflow/codex-home`, so the operator-local
tool is not visible.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC 1: Red reproduction proves nested tool resolution fails on the parent implementation | `test/task-2211-codex-isolation-repro.test.js:7`, `node --test test/task-2211-codex-isolation-repro.test.js` | PASS |
| SC 2: Reproduction can become green without operator `~/.codex` | `test/task-2211-codex-isolation-repro.test.js:14` | PENDING CP-3 |
| SC 3: Codex config, auth, skill, and telemetry remain worktree-local | `lib/agents/codex.ts:158`, `test/codex.test.js` | PENDING CP-3 |
| SC 4: Only nested-tool resolution is restored rather than full Codex state | `test/task-2211-codex-isolation-repro.test.js:23` | PENDING CP-3 |
| SC 5: Operator-facing isolated-home documentation matches the boundary | `docs/agents.md:27`, `docs/operator-setup.md:45` | PENDING CP-4 |
| SC 6: Static analysis passes | `./scripts/verify-local.sh static-analysis` | PENDING CP-4 |
| SC 7: General verification passes | `./scripts/verify-local.sh all` | PENDING CP-4 |

Next action: trace the precise `HOME` and Codex-state paths in `lib/agents/codex.ts` to select the smallest environment boundary change.

# CP-2 — Launcher boundary trace

The trace identifies two independent contracts. `ensureCodexHome` writes the
worktree-local config, copies auth and the Graphify skill there, and telemetry
is read from that same worktree-local root. In contrast, non-interactive and
resume invocations currently replace `HOME`, which changes the environment seen
by nested tools. The minimal boundary is to preserve the inherited `HOME` and
set `CODEX_HOME` to `<worktree>/.workflow/codex-home/.codex`; that is the
Codex-specific state directory and keeps existing config/auth/session paths
unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC 1: Red reproduction proves nested tool resolution fails on the parent implementation | `test/task-2211-codex-isolation-repro.test.js:7`, `node --test test/task-2211-codex-isolation-repro.test.js` | PASS |
| SC 2: Reproduction can become green without operator `~/.codex` | `test/task-2211-codex-isolation-repro.test.js:23` | PENDING CP-3 |
| SC 3: Codex config, auth, skill, and telemetry remain worktree-local | `lib/agents/codex.ts:162`, `lib/agents/codex.ts:166`, `lib/agents/codex.ts:124`, `test/codex.test.js` | PENDING CP-3 |
| SC 4: Only nested-tool resolution is restored rather than full Codex state | `lib/agents/codex.ts:84`, `lib/agents/codex.ts:86` | PENDING CP-3 |
| SC 5: Operator-facing isolated-home documentation matches the boundary | `docs/agents.md:27`, `docs/operator-setup.md:45` | PENDING CP-4 |
| SC 6: Static analysis passes | `./scripts/verify-local.sh static-analysis` | PENDING CP-4 |
| SC 7: General verification passes | `./scripts/verify-local.sh all` | PENDING CP-4 |

Next action: change both non-interactive and resume invocation environments to set `CODEX_HOME` while retaining the inherited operator `HOME`, then add config/auth/skill/telemetry preservation coverage.

# CP-3 — Isolated Codex state with retained operator tool resolution

Changed the non-interactive and resume launcher environments to set
`CODEX_HOME` to `<worktree>/.workflow/codex-home/.codex` instead of replacing
`HOME`. This preserves Codex config, copied auth, seeded Graphify skill, and
rollout telemetry under the worktree while nested commands retain the operator
`HOME` and inherited `PATH`. Focused tests cover the red-to-green reproduction
and every preserved state location.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC 1: Red reproduction proves nested tool resolution fails on the parent implementation | `test/task-2211-codex-isolation-repro.test.js:7`, `node --test test/task-2211-codex-isolation-repro.test.js` | PASS |
| SC 2: Reproduction passes without operator `~/.codex` or worktree changes | `test/task-2211-codex-isolation-repro.test.js:22`, `"codex isolation repro keeps operator-home nested tool resolution while isolating Codex state"` | PASS |
| SC 3: Codex config, auth, skill, and telemetry remain worktree-local | `lib/agents/codex.ts:166`, `lib/agents/codex.ts:170`, `lib/agents/codex.ts:124`, `test/task-2211-codex-isolation-repro.test.js:32` | PASS |
| SC 4: Only the Codex state directory is overridden | `lib/agents/codex.ts:74`, `lib/agents/codex.ts:95` | PASS |
| SC 5: Operator-facing isolated-home documentation matches the boundary | `docs/agents.md:27`, `docs/operator-setup.md:45` | PENDING CP-4 |
| SC 6: Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |
| SC 7: General verification passes | `./scripts/verify-local.sh all` | PENDING CP-4 |

Next action: revise the operator-facing launcher documentation to describe `CODEX_HOME` isolation and retained nested-tool resolution, then run the complete verification gate.

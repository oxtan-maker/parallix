# CP-4 — Documentation and verification

Updated both operator-facing descriptions of Codex isolation. They now state
that Parallix sets worktree-local `CODEX_HOME` for Codex state while retaining
the operator `HOME` and `PATH` for nested OpenCode and Pi tools. The final
verification gates passed on this tree.

Review round 1 confirmed the two reported model/backlog artifacts are already
on `skunkworks`, not in this mission's `skunkworks...HEAD` diff. The redundant
non-interactive `CODEX_HOME` assignment was removed; the final environment
spread remains the single worktree-state override.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC 1: The parent implementation has a red nested-tool reproduction | `test/task-2211-codex-isolation-repro.test.js:7`, `node --test test/task-2211-codex-isolation-repro.test.js` | PASS |
| SC 2: The same reproduction passes with operator-local tool resolution and no global Codex state dependency | `test/task-2211-codex-isolation-repro.test.js:14`, `"codex isolation repro keeps operator-home nested tool resolution while isolating Codex state"` | PASS |
| SC 3: Config, auth, skill seed, and telemetry remain worktree-local | `lib/agents/codex.ts:204`, `lib/agents/codex.ts:208`, `lib/agents/codex.ts:121`, `"Codex config, auth, skill seed, and rollout telemetry remain under the worktree state directory"` | PASS |
| SC 4: The launcher restores only nested-tool environment access, not Codex state | `lib/agents/codex.ts:74`, `lib/agents/codex.ts:92`, `lib/agents/codex.ts:159` | PASS |
| SC 5: Operator docs name the corrected boundary and nested tools | `docs/agents.md:27`, `docs/operator-setup.md:47` | PASS |
| SC 6: Required static analysis is clean | `./scripts/verify-local.sh static-analysis` | PASS |
| SC 7: Required general verification is clean | `./scripts/verify-local.sh all` | PASS |

Next action: provide the review-loop disposition noting the rebasing-artifact pushback and the completed launcher cleanup.

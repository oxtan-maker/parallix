# CP-4: Verification gate and final Goal Check

## Summary

Ran `./scripts/verify-local.sh all` on the final tree after rebuilding compiled
artifacts (`npm run build:cjs`). The gate exited 0. The full test run reported
`tests 2091, pass 2068, fail 0, skipped 23, todo 0` (skips are pre-existing
and unrelated to this mission; no `.only` or bare `.skip` were introduced by
this change — confirmed via `grep -rn "\.only(" test/` and `grep -rn
"test\.skip\|it\.skip" test/*.js`, both empty).

Also updated `docs/agents.md:27` to document that the codex launcher now
appends `[mcp]`/`[mcp.*]` sections from the operator's real
`~/.codex/config.toml` into the worktree codex-home, alongside the existing
description of the `auth.json` copy and base config seeding (DoD item: docs
updated to reflect user-facing behavior change).

Final implementation:
- `lib/agents/codex.ts:174` — `userCodexConfigPath()`
- `lib/agents/codex.ts:187` — `extractMcpSections(toml)`
- `lib/agents/codex.ts:233-258` — `ensureCodexHome` now appends extracted MCP
  sections from the operator's real config after the base `headlessCodexConfig`
  write and before the `auth.json` copy, skipping silently when the source is
  absent.

Reproduction test confirmed red-on-parent (see CP-1) and green-on-fix (see
CP-2), satisfying DoD item #6 (bug-labeled missions require a red-to-green
reproduction test).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: copies `~/.codex/config.toml` MCP sections into worktree config when source exists | `lib/agents/codex.ts:243-248`; `"ensureCodexHome merges MCP sections from the operator config when present"` in `test/codex.test.js` | PASS |
| SC2: skips MCP copy without throwing when source config.toml absent | `lib/agents/codex.ts:244` guard; `"ensureCodexHome skips MCP merge without throwing when operator config.toml is absent"` in `test/codex.test.js` | PASS |
| SC3: existing auth.json copy behavior unchanged | `lib/agents/codex.ts:250-253`; `"codexAuthPath returns the expected path"` in `test/codex.test.js` | PASS |
| SC4: existing graphify-skill seeding behavior unchanged | `lib/agents/codex.ts:255-266`; `"ensureCodexHome seeds the global graphify skill into the worktree HOME"`, `"ensureCodexHome skips skill seeding when no global skill is installed"` in `test/codex.test.js` | PASS |
| SC5: `./scripts/verify-local.sh all` exits 0 | `./scripts/verify-local.sh all` — exit code 0, `tests 2091, pass 2068, fail 0` | PASS |
| SC6: reproduction test fails on parent commit, passes after fix | `test/codex-mcp-worktree-repro.test.js`, `"MCP config is carried into worktree codex-home (reproduction)"` — verified red via `git stash -u` + rebuild against unmodified `ensureCodexHome` (see CP-1), green after fix (see CP-2) | PASS |
| DoD: no `.only`/bare `.skip` introduced | `./scripts/verify-local.sh all` (test hygiene check) — exit 0; no `.only`/`.skip` present in `test/codex.test.js` or `test/codex-mcp-worktree-repro.test.js` | PASS |
| DoD: docs updated for user-facing behavior change | `docs/agents.md:27` | PASS |

## Gates
- [x] `./scripts/verify-local.sh all` (static-analysis + test hygiene) — exit 0

Next action: hand off to review; no further implementation work remains on `lib/agents/codex.ts` or `test/codex.test.js` for this mission.

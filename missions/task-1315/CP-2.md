# CP-2: One-Time Install + Codex Copy-Seed

## Summary
Performed the one-time global Graphify skill install for the three supported platforms and implemented Codex's worktree-HOME seeding as a plain filesystem copy of the global skill in `ensureCodexHome` — not a per-launch `graphify install`. Removed the `--project`-scoped `.opencode/` artifact the installer dropped in the repo. Added focused copy-seed tests and ran the full suite.

## Work Done
- Ran one-time `graphify install --platform claude|codex|opencode` against the operator's real config dirs (CLI at `~/.local/bin/graphify`).
- Implemented the idempotent skill copy-seed in `ensureCodexHome` (`lib/agents/codex.js:154-164`): copies `~/.agents/skills/graphify/` into `<worktree>/.workflow/codex-home/.agents/skills/graphify/` via `fs.cpSync`, guarded by `fs.existsSync`, right after the `auth.json` copy.
- Removed the repo-local `.opencode/` plugin artifact the opencode installer wrote into cwd (`--project`-style side effect); confirmed it is not tracked.
- Added two copy-seed tests to `test/codex.test.js`.

## Goal Check

| # | Criterion | Evidence | Status |
|---|---|---|---|
| 1 | One-time install lands skills for claude/codex/opencode | Live install output: `~/.claude/skills/graphify/SKILL.md`, `~/.agents/skills/graphify/SKILL.md`, `~/.config/opencode/skills/graphify/SKILL.md` all present (verified `-f` checks) | ✅ |
| 2 | `ensureCodexHome` seeds skill into worktree-local HOME, not real home | `lib/agents/codex.js:157-164`; test `ensureCodexHome seeds the global graphify skill into the worktree HOME` (`test/codex.test.js`) asserts `<worktree>/.workflow/codex-home/.agents/skills/graphify/SKILL.md` exists | ✅ |
| 3 | Copy-seed is idempotent and skips cleanly when no global skill | Same test re-runs `ensureCodexHome` (target stays); test `ensureCodexHome skips skill seeding when no global skill is installed` asserts config written but no skill | ✅ |
| 4 | No launcher invokes `graphify install`; only `fs.cpSync` per mission | `grep -rn "graphify install\|'install'" lib/agents/` → only a code comment (`codex.js:155`), no invocation | ✅ |
| 5 | mistral not attempted, no error | No mistral platform referenced anywhere in install path; `lib/agents/mistral.js` untouched | ✅ |
| 6 | Retained pipeline intact; no `graphify-out/` or `.opencode/` committed | `git check-ignore graphify-out/graph.json` succeeds; `npm pack --dry-run --json` → 0 `graphify-out` entries; `git status` clean (no `.opencode/`) | ✅ |
| 7 | Operator docs list install commands, copy-seed, mistral limit, CLI bootstrap | `docs/operator-setup.md` | ✅ |
| 8 | `npm test` zero failures | `npm test` → tests 1519, pass 1497, fail 0 (22 skipped) | ✅ |

## Gates
- [x] Codex copy-seed test passes
- [x] Idempotent re-seed + clean-skip tests pass
- [x] No `graphify install` invocation in `lib/agents/`
- [x] `npm pack --dry-run --json` contains no `graphify-out/`/`.opencode/` entries
- [x] `git check-ignore graphify-out/graph.json` succeeds
- [x] npm test (1497 pass, 0 fail)

## Next action: Commit mission + checkpoint docs and hand off to review.

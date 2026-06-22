# CP-1: Audit and Contract

## Summary
Audited the launcher modules, Graphify integration points, and `graphify-out/` exclusion rules to confirm the per-family config dir / Graphify platform mappings and what the retained pipeline does. Confirmed agents never invoke Graphify and that the real gap is the per-agent skill, installed once per platform.

## Launcher → Config Dir → Graphify Platform Mapping

| Agent Family | Launcher Module | Config Dir | Graphify Platform | Notes |
|---|---|---|---|---|
| `claude` | `lib/agents/claude.js` | `~/.claude/skills/graphify/` | `--platform claude` | Inherits `process.env`; one-time global install reaches it. |
| `codex` | `lib/agents/codex.js` | `<worktree>/.workflow/codex-home/.agents/skills/graphify/` | `--platform codex` (global → `~/.agents/skills/`) | Runs with `HOME=codexHomeRoot` (`codex.js:104`); ephemeral HOME rebuilt per mission, so it is seeded by copying the global skill in `ensureCodexHome`. |
| `qwen` | `lib/agents/opencode.js` | `~/.config/opencode/skills/graphify/` | `--platform opencode` | Inherits `process.env`. Opencode launcher maps to qwen. |
| `mistral` | `lib/agents/mistral.js` | N/A | N/A | Excluded — Graphify ships no mistral/vibe platform. |

## Contract Confirmations
1. **Agents never invoke Graphify.** Parallix runs `graphify update .` in its own process. The deliverable is the per-agent skill, not CLI propagation.
2. **`graphify update .` runs at:** before review (`review-loop.js`, cwd = mission worktree); after integration (`integrate.js`, cwd = primary worktree); draft creates `graphify-out/` + `.graphifyignore`.
3. **Non-blocking behavior** preserved: update points warn and continue on probe/update failure.
4. **CLI resolution order** preserved: `GRAPHIFY_BIN` → `graphify` on PATH → `~/.local/bin/graphify`.
5. **`graphify-out/` exclusion:** `.gitignore` ignores `graphify-out/`; `npm pack` excludes it; `git check-ignore graphify-out/graph.json` succeeds.

## Key Decision
The skill install is a **one-time operator step**, not launcher code. The only per-mission action needed is seeding Codex's ephemeral worktree HOME, done with a filesystem copy of the already-installed global skill (mirroring the existing `auth.json` copy) — never a per-launch `graphify install` subprocess.

## Next action: CP-2 — run the one-time install, implement the codex copy-seed, add tests, run full npm test.

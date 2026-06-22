---
id: TASK-1315
title: Park graphify indexing follow-up
status: done
assignee: [qwen]
created_date: '2026-06-15 17:36'
updated_date: '2026-06-15 18:14'
labels:
  - ai_sdlc
dependencies: []
priority: low
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Install the Graphify knowledge-graph skill into each agent CLI parallix launches, so the agent consults the graph (god nodes, communities, `graphify query`) instead of grepping raw files. This is the genuine remaining gap. The graph generation/update pipeline already works and is **out of scope to re-implement**: draft creates/ignores `graphify-out/` (`draft.js`), and review/integration run `graphify update .` in parallix's own process (`review-loop.js`, `integrate.js`, `mission-utils.js`). Parallix — not the agents — invokes that update, so the earlier "pass the resolved Graphify CLI through each agent launcher environment" framing was incorrect and is dropped.

Graphify ships a per-platform installer, `graphify install --platform <P>`, that copies a platform-specific skill (and, for Claude only, a `CLAUDE.md` directive plus a `PreToolUse` hook in `settings.json`) into that agent's config dir. Map each configured family to its launcher and Graphify platform and install idempotently:

- `claude` → claude CLI → `graphify install --platform claude` → `~/.claude/skills/graphify/` + `CLAUDE.md` + `PreToolUse` hook (honors `CLAUDE_CONFIG_DIR`).
- `codex` → codex CLI → `graphify install --platform codex` → `$HOME/.agents/skills/graphify/`, plus `multi_agent = true` under `[features]` in `~/.codex/config.toml`. Parallix runs codex with a worktree-local HOME (`<worktree>/.workflow/codex-home`, see `codex.js`), so the install MUST target that HOME (set `HOME` for the install, or use Graphify `--project` scope) — a global install to the operator's real home is invisible to codex.
- `qwen` → opencode CLI → `graphify install --platform opencode` → `~/.config/opencode/skills/graphify/`.
- `mistral` → vibe CLI → **excluded from this task.** Graphify exposes no mistral/vibe platform, so vibe is unsupported by Graphify's installer; track separately. The bootstrap must skip mistral without error and not invent a mistral-specific fork.

Also provide a reproducible way to obtain the `graphify` CLI itself (a pip-installed Python tool today resolved from `GRAPHIFY_BIN`, `PATH`, then `~/.local/bin/graphify`) rather than depending on undocumented workstation state. claude/opencode/mistral launchers inherit `process.env`, so a one-time global skill install reaches them; only codex's isolated HOME needs special handling.
<!-- SECTION:DESCRIPTION:END -->

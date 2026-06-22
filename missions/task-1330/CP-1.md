# CP-1: Audit Complete — Graphify Gap Analysis

## Overview

Audited all in-scope files for Graphify readiness across the three supported agent families (Claude, Codex, OpenCode/Qwen) and all five workflow prompts.

## Gap Table

| Area | File | Lines | Current State | Gap |
|------|------|-------|---------------|-----|
| Codex config | `lib/agents/codex.js` | 157-171 | `headlessCodexConfig()` emits TOML with `sandbox_mode`, `projects.*` blocks | Missing `[features]` section with `multi_agent = true` |
| Codex skill copy | `lib/agents/codex.js` | 190-197 | `ensureCodexHome()` copies Graphify skill into worktree-local HOME | OK — skill is seeded |
| Claude template | `templates/CLAUDE.md.template` | 1-17 | Project rules, runtime rules, command wrappers | No `## graphify` section |
| Agents template | `templates/AGENTS.md.template` | 1-21 | Hard rules, workflow modes | No `## graphify` section |
| Codex template | `templates/CODEX.md.template` | 1-25 | Runtime rules, command surface | No `## graphify` section |
| Mistral template | `templates/MISTRAL.md.template` | 1-24 | Runtime rules, mode mapping, vibe commands | Unchanged — out of scope |
| Prompt: draft | `prompts/draft.md` | 1-18 | Mission drafting instructions | Zero graphify references |
| Prompt: execute | `prompts/execute.md` | 1-22 | Execution instructions | Zero graphify references |
| Prompt: review | `prompts/review.md` | 1-16 | Review loop contract | Zero graphify references |
| Prompt: act-on-review | `prompts/act-on-review.md` | 1-20 | Review fix instructions | Zero graphify references |
| Prompt: portfolio | `prompts/portfolio.md` | 1-28 | Portfolio proposal instructions | Zero graphify references |

## Upstream Evidence

- `always_on/claude-md.md` (9 lines): Defines `## graphify` section with `graphify query`, `graphify path`, `graphify explain`, and `graphify update .` rules.
- `always_on/agents-md.md` (12 lines): Same rules plus `/graphify` skill-tool trigger and dirty-graph tolerance rule.
- `skill-codex.md` line 233: Explicitly states `Requires multi_agent = true under [features] in ~/.codex/config.toml`.
- `skill-opencode.md` line 232: Describes `@mention` dispatch for OpenCode subagents.

## Summary

- **1 critical gap**: Codex `multi_agent = true` missing from config (SC1 at risk).
- **6 content gaps**: Three templates + five prompts (minus MISTRAL which is out of scope) all lack graphify references (SC3-SC5 at risk).
- **0 always-on files**: No local `CLAUDE.md`, no local `AGENTS.md` graphify section, no `.opencode/` plugin wiring (SC2 at risk).

## Next action

Apply CP-2: Fix `headlessCodexConfig()` in `lib/agents/codex.js` to emit `multi_agent = true` under `[features]`.

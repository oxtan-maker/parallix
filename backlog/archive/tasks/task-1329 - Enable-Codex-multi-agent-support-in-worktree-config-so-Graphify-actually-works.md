---
id: TASK-1329
title: Enable Codex multi-agent support in worktree config so Graphify actually works
status: backlog
assignee: []
created_date: '2026-06-22 03:55'
labels:
  - ai_sdlc
  - bug
dependencies: []
references:
  - /home/magnus/code/parallix/lib/agents/codex.js
  - /home/magnus/code/parallix/docs/operator-setup.md
  - /home/magnus/.agents/skills/graphify/SKILL.md
  - /home/magnus/code/parallix-task-1273/.workflow/codex-home/.codex/config.toml
  - /home/magnus/.claude/skills/graphify/SKILL.md
  - /home/magnus/.config/opencode/skills/graphify/SKILL.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The current Graphify integration is not actually complete for all supported agents. Runtime evidence shows Claude and Opencode have global Graphify skill installs present, but Codex's worktree-local HOME is missing a required config flag, so the copied skill is not necessarily usable.

Evidence:
- `lib/agents/codex.js` writes the worktree-local `config.toml` in `headlessCodexConfig()`, but only emits `sandbox_mode` plus trusted project stanzas. It does not emit `[features]` / `multi_agent = true`.
- The installed Graphify skill for Codex explicitly says: `Requires multi_agent = true under [features] in ~/.codex/config.toml.` See `/home/magnus/.agents/skills/graphify/SKILL.md` around Step B2.
- Existing Codex worktree evidence matches the code path: `/home/magnus/code/parallix-task-1273/.workflow/codex-home/.codex/config.toml` contains only `sandbox_mode` and project trust settings, with no `[features]` block.
- Existing global skill installs are present for the non-Codex families: `/home/magnus/.claude/skills/graphify/SKILL.md`, `/home/magnus/.config/opencode/skills/graphify/SKILL.md`, and `/home/magnus/.agents/skills/graphify/SKILL.md` all exist.

Why this matters:
- Parallix currently treats the Graphify rollout as done, but for Codex the harness only copies the skill directory into `<worktree>/.workflow/codex-home/.agents/skills/graphify/`. It does not satisfy the skill's own runtime prerequisite for subagent dispatch.
- Because the Graphify Codex flow depends on `spawn_agent`/`wait_agent`/`close_agent`, missing `multi_agent = true` means the claim that Graphify is available to all supported agents is overstated.

Proposed scope:
- Update the generated Codex config so worktree-local `config.toml` includes `[features]` with `multi_agent = true`.
- Add or update tests covering `headlessCodexConfig()` / `ensureCodexHome()` so the generated worktree-local config retains the existing trust settings and also enables multi-agent support.
- Update operator docs to mention that Codex Graphify usage depends on the worktree-local config including `multi_agent = true`, not just on copying the skill directory.
- Re-audit the completed task-1315 docs and acceptance claims so they match actual runtime behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `headlessCodexConfig()` emits a `[features]` block with `multi_agent = true` in every generated worktree-local Codex config.
- [ ] #2 A test proves `ensureCodexHome()` writes a worktree-local `config.toml` that still includes the trusted project entries and now also includes `multi_agent = true`.
- [ ] #3 The task includes a regression check or targeted test that would fail if future edits remove the `multi_agent` setting from Codex's generated config.
- [ ] #4 Operator-facing docs are updated so Codex Graphify readiness is described in terms of both skill copy-seeding and the required multi-agent config.
- [ ] #5 The resulting implementation is verified against at least one existing or freshly generated mission worktree showing both the seeded Graphify skill and the required `multi_agent = true` setting.
<!-- AC:END -->

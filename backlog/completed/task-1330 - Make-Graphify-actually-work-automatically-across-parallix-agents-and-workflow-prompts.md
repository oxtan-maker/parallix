---
id: TASK-1330
title: >-
  Make Graphify actually work automatically across parallix agents and workflow
  prompts
status: done
assignee: [qwen]
created_date: '2026-06-22 03:58'
updated_date: '2026-06-22 04:02'
labels:
  - ai_sdlc
  - bug
  - prompt
dependencies: []
references:
  - /home/magnus/code/parallix/prompts/draft.md
  - /home/magnus/code/parallix/prompts/execute.md
  - /home/magnus/code/parallix/prompts/review.md
  - /home/magnus/code/parallix/prompts/act-on-review.md
  - /home/magnus/code/parallix/prompts/portfolio.md
  - /home/magnus/code/parallix/templates/CODEX.md.template
  - /home/magnus/code/parallix/templates/CLAUDE.md.template
  - /home/magnus/code/parallix/templates/AGENTS.md.template
  - /home/magnus/code/parallix/lib/agents/codex.js
  - /home/magnus/.local/lib/python3.13/site-packages/graphify/__main__.py
  - >-
    /home/magnus/.local/lib/python3.13/site-packages/graphify/always_on/agents-md.md
  - /home/magnus/.agents/skills/graphify/references/hooks.md
  - /home/magnus/.agents/skills/graphify/SKILL.md
  - 'https://github.com/safishamsi/graphify'
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Graphify follow-up should be tracked as one task, not split across installation/runtime and prompt/usage questions. Research shows parallix currently has two distinct gaps that together prevent the intended outcome.

Gap 1: Graphify is not actually ready across all relevant agents/platforms.
- Codex: parallix copies the Graphify skill into the worktree-local Codex HOME, but `headlessCodexConfig()` does not emit the required `[features]` / `multi_agent = true` setting. The installed Codex Graphify skill explicitly requires that setting for its subagent flow.
- Claude and OpenCode: global skill files exist, but parallix has not adopted Graphify's official per-project always-on installation for those platforms. Existing repo/worktree evidence shows no local `CLAUDE.md`, no `.codex/hooks.json`, no `.opencode/` plugin wiring, and no local `AGENTS.md` Graphify section.
- Mistral: Graphify has no supported mistral/vibe platform and should remain explicitly out of scope or separately tracked.

Gap 2: parallix's actual workflow prompts do not prove Graphify will be used automatically.
- Shared workflow prompts (`prompts/draft.md`, `prompts/execute.md`, `prompts/review.md`, `prompts/act-on-review.md`, `prompts/portfolio.md`) do not mention `graphify`, `/graphify`, `graphify query`, `GRAPH_REPORT.md`, or any graph-first instruction.
- Agent adapter templates (`templates/CODEX.md.template`, `templates/CLAUDE.md.template`, `templates/MISTRAL.md.template`, `templates/AGENTS.md.template`) likewise do not add Graphify-specific behavior.
- There is no local evidence from current repo/worktree scaffolding that launched agents receive Graphify's official always-on guidance.

Official Graphify contract:
- Upstream Graphify distinguishes basic skill installation from platform-specific always-on installation.
- Official upstream docs and installed package code say:
  - `graphify claude install` writes `CLAUDE.md` plus a PreToolUse hook.
  - `graphify codex install` writes `AGENTS.md` plus `.codex/hooks.json`.
  - `graphify opencode install` writes `AGENTS.md` plus an `.opencode` `tool.execute.before` plugin.
- The packaged always-on AGENTS.md block tells the agent to run `graphify query "<question>"` first when `graphify-out/graph.json` exists, use `path`/`explain` for focused context, and run `graphify update .` after code changes.

Why this matters:
- Basic user-profile skill presence is not enough to claim that parallix agents will automatically use Graphify on real workflow prompts.
- The current rollout appears to overstate completeness because it neither guarantees platform readiness across agents nor wires in the official always-on usage path.

Proposed scope:
- Establish one explicit parallix contract for Graphify usage during workflow runs.
- Implement the missing runtime/platform prerequisites, including Codex multi-agent support and any required project-local Graphify wiring for supported families.
- Decide whether parallix should rely on Graphify's official project-local always-on integration, explicit workflow prompt instructions, or a justified hybrid.
- Ensure the chosen approach is applied consistently across the supported Graphify families parallix launches: `claude`, `codex`, and `qwen`/OpenCode.
- Re-audit prior docs and completed-task claims so they match real runtime behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Codex worktree-local config includes the Graphify-required `[features]` / `multi_agent = true` setting, with regression coverage proving future changes cannot silently remove it.
- [ ] #2 Parallix defines one explicit contract for Graphify usage during workflow runs: official project-local always-on integration, explicit prompt invocation, or a clearly justified hybrid.
- [ ] #3 The chosen contract is implemented for each supported Graphify family that parallix launches (`claude`, `codex`, `qwen`/OpenCode), with `mistral` explicitly excluded or separately tracked.
- [ ] #4 A verification artifact proves whether each in-scope workflow mode that should use Graphify (`execute`, `review`, `act-on-review`, and any others chosen) will actually surface Graphify guidance to the launched agent without relying on operator memory.
- [ ] #5 If official always-on integration is chosen, generated repo/worktree scaffolding contains the expected Graphify project files or hooks for each relevant platform, and packaging/tracking implications are handled explicitly.
- [ ] #6 If prompt-based integration is chosen, the relevant prompt/template files contain clear Graphify-first instructions tied to `graphify-out/graph.json` existence and codebase-question use cases.
- [ ] #7 The resulting implementation is verified against at least one generated or existing worktree per relevant platform, showing both Graphify readiness and the automatic-usage path.
- [ ] #8 The task outcome links to upstream Graphify documentation or installed package-source evidence showing why the chosen integration path matches the official contract.
<!-- AC:END -->

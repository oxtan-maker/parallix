# Mission: Make Graphify Actually Work Automatically Across Parallix Agents and Workflow Prompts (task-1330)

## Goal

Establish a verifiable, platform-by-platform contract for Graphify usage during parallix workflow runs so that every supported agent launched by parallix (Claude, Codex, Qwen/OpenCode) automatically receives Graphify's official always-on guidance without requiring operator memory. Specifically: fix the missing `[features] multi_agent = true` in `headlessCodexConfig()` at `lib/agents/codex.js:157-171`, decide whether parallix uses Graphify's official project-local always-on integration, explicit prompt invocation, or a justified hybrid, and wire the chosen approach into all five workflow prompts (`prompts/draft.md`, `prompts/execute.md`, `prompts/review.md`, `prompts/act-on-review.md`, `prompts/portfolio.md`) and all three agent adapter templates (`templates/CODEX.md.template`, `templates/CLAUDE.md.template`, `templates/AGENTS.md.template`).

## Why Now

Parallix's current Graphify rollout overstates completeness. The Graphify skill is copied into the Codex worktree-local HOME via `ensureCodexHome()` at `lib/agents/codex.js:190-197`, but the Graphify skill's Codex subagent flow explicitly requires `multi_agent = true` under `[features]` in the Codex config — a setting that `headlessCodexConfig()` at `lib/agents/codex.js:157-171` does not emit. Meanwhile, parallix has no local `CLAUDE.md`, no `.codex/hooks.json`, no `.opencode/` plugin wiring, and no local `AGENTS.md` Graphify section, meaning Claude and OpenCode lack Graphify's official always-on installation. Critically, none of the five shared workflow prompts mention `graphify`, `/graphify`, `graphify query`, `GRAPH_REPORT.md`, or any graph-first instruction, so launched agents have no automatic path to use Graphify. Without fixing both gaps, parallix cannot claim that agents will automatically use Graphify during workflow runs.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: Codex `multi_agent` config gap, zero prompt-level Graphify references across all workflow prompts, absence of project-local always-on integration files

## Scope

- **Codex config fix**: Add `multi_agent = true` under `[features]` in `headlessCodexConfig()` at `lib/agents/codex.js:157-171`, ensuring future changes cannot silently remove it (documented in code comment or test).
- **Contract decision**: Produce one explicit contract statement (in `AGENTS.md` or `MISSION.md`) choosing among: (a) official project-local always-on integration via `graphify claude install` / `graphify codex install` / `graphify opencode install`, (b) explicit prompt-based invocation in workflow prompts, or (c) a justified hybrid. The decision must cite upstream Graphify documentation or installed package-source evidence.
- **Contract wiring for supported families**: Implement the chosen contract for each supported Graphify family that parallix launches:
  - **Claude**: Add Graphify always-on guidance to `templates/CLAUDE.md.template` and/or generate repo-local `CLAUDE.md` with content matching `/home/magnus/.local/lib/python3.13/site-packages/graphify/always_on/claude-md.md`.
  - **Codex**: Add Graphify always-on guidance to `templates/AGENTS.md.template` and/or generate repo-local `AGENTS.md` with content matching `/home/magnus/.local/lib/python3.13/site-packages/graphify/always_on/agents-md.md`. Ensure `ensureCodexHome()` copies the Graphify skill into worktree-local HOME (already present at `lib/agents/codex.js:190-197`).
  - **Qwen/OpenCode**: Add Graphify always-on guidance to `templates/AGENTS.md.template` and/or ensure `.opencode/` plugin wiring exists.
- **Prompt updates**: Add Graphify-first instructions to all five workflow prompts (`prompts/draft.md`, `prompts/execute.md`, `prompts/review.md`, `prompts/act-on-review.md`, `prompts/portfolio.md`) so that they reference `graphify-out/graph.json` existence and describe when to use `graphify query`, `graphify path`, `graphify explain`, or `graphify update .`.
- **Verification artifact**: Produce evidence (checkpoint documents or a verification script) proving that each in-scope workflow mode surfaces Graphify guidance to the launched agent without relying on operator memory.

## Out of Scope

- **Mistral/Vibe platform**: Graphify has no supported Mistral/vibe platform. `templates/MISTRAL.md.template` remains unchanged.
- **Full Graphify pipeline implementation**: This mission does not modify Graphify's upstream code, extraction logic, or graph-building algorithms.
- **Runtime execution of graphify**: This mission does not run `graphify build` or `graphify query` against the parallix codebase. It wires the *instructions* and *prerequisites* for agents to do so.
- **Hook infrastructure**: Installing post-commit hooks (`graphify hooks`) is out of scope; this mission addresses the always-on guidance path only.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. **SC1**: `lib/agents/codex.js` `headlessCodexConfig()` (line 157) returns a TOML string containing `[features]` section with `multi_agent = true`. Verified by reading the function output and confirming the substring `[features]` and `multi_agent = true` are present.

2. **SC2**: A contract decision document exists in the mission deliverables (either embedded in `MISSION.md` or as a separate `.md` file in `missions/task-1330/`) that explicitly names one of: "official always-on", "prompt-based", or "hybrid". The document cites at least one source from: `/home/magnus/.local/lib/python3.13/site-packages/graphify/always_on/agents-md.md`, `/home/magnus/.local/lib/python3.13/site-packages/graphify/always_on/claude-md.md`, `/home/magnus/.local/lib/python3.13/site-packages/graphify/skill-codex.md`, `/home/magnus/.local/lib/python3.13/site-packages/graphify/skill-opencode.md`, or the upstream repo at `https://github.com/safishamsi/graphify`.

3. **SC3**: `templates/CLAUDE.md.template` contains a `## graphify` section with at least the following directives: run `graphify query "<question>"` when `graphify-out/graph.json` exists, use `graphify path` and `graphify explain` for focused queries, and run `graphify update .` after code changes. Verified by grepping the file for `graphify query` and `graphify update`.

4. **SC4**: `templates/AGENTS.md.template` contains a `## graphify` section (or `# Agent Instructions` section updated) with at least the following directives: run `graphify query "<question>"` when `graphify-out/graph.json` exists, use `graphify path` and `graphify explain`, and run `graphify update .` after code changes. Verified by grepping for `graphify query`.

5. **SC5**: All five workflow prompts contain at least one reference to graphify-related concepts. Specifically: `prompts/draft.md`, `prompts/execute.md`, `prompts/review.md`, `prompts/act-on-review.md`, and `prompts/portfolio.md` each contain at least one of the substrings: `graphify`, `graphify query`, `GRAPH_REPORT.md`, or `graphify-out`. Verified by grepping each file.

6. **SC6**: `templates/MISTRAL.md.template` is unchanged from its original content (no Graphify sections added), confirming Mistral remains explicitly excluded. Verified by diff against the original file.

7. **SC7**: The backlog task file at `backlog/tasks/task-1330 - Make-Graphify-actually-work-automatically-across-parallix-agents-and-workflow-prompts.md` exists, is not renamed or moved, and retains at least one of the original labels (`ai_sdlc`, `bug`, `prompt`).

## Risks and Assumptions

- **Assumption**: The Graphify Python package (`graphifyy`) and its `graphify` CLI are available in the operator's environment. The always-on guidance assumes the agent can invoke `graphify query`, `graphify path`, etc.
- **Assumption**: Codex's `multi_agent = true` setting is supported by the version of Codex used by parallix. If the installed Codex predates this feature, the config addition alone is insufficient and a version bump may be needed (documented as a follow-up).
- **Risk**: Adding Graphify instructions to prompts increases prompt length and may affect token budgets for agents. Mitigation: keep Graphify references concise, limited to the fast-path behavior described in upstream always-on files.
- **Risk**: The hybrid approach (if chosen) introduces complexity in deciding when to use always-on vs. prompt-based instructions. Mitigation: the contract document must define clear precedence rules (e.g., always-on takes priority when `graphify-out/graph.json` exists).
- **Assumption**: The Graphify skill files in `~/.agents/skills/graphify/` and `~/.local/lib/python3.13/site-packages/graphify/` are the authoritative source for always-on guidance content.

## Contract Decision

**Choice: official always-on**

Parallix adopts Graphify's official project-local always-on integration for all supported agent families. Rationale:

1. **Upstream support is universal**: Graphify provides official always-on files for all three platforms parallix supports. `skill-codex.md` confirms Codex support with `multi_agent = true` requirement (line 233). `skill-opencode.md` confirms OpenCode support with `@mention` dispatch (line 232). The always-on package at `/home/magnus/.local/lib/python3.13/site-packages/graphify/always_on/` provides `claude-md.md` and `agents-md.md` with ready-made guidance content.

2. **Official commands exist for all platforms**: The Graphify install contract specifies `graphify claude install` (writes CLAUDE.md + PreToolUse hook), `graphify codex install` (writes AGENTS.md + .codex/hooks.json), and `graphify opencode install` (writes AGENTS.md + .opencode tool.execute.before plugin) — confirmed by the upstream skill docs at `skill-codex.md` and `skill-opencode.md`.

3. **Hybrid adds complexity without benefit**: A prompt-based or hybrid approach would duplicate the always-on rules in workflow prompts while also needing template-level guidance. The always-on files already define clear precedence (fast path when graph.json exists; full pipeline otherwise). Embedding the same rules into templates achieves the always-on outcome without running upstream install commands that would modify external files.

4. **Precedence rule**: Always-on guidance in agent templates takes priority. When `graphify-out/graph.json` exists, agents use the fast path (`graphify query`). When it does not exist, agents run the full pipeline. Workflow prompts reinforce this by instructing agents to check for `graphify-out/graph.json` existence before answering codebase questions.

## Checkpoints

- **CP 1**: Audit complete. Document current state of each platform (Codex config, Claude, OpenCode, prompts, templates) with specific file:line evidence of gaps. Deliverable: `missions/task-1330/CP-1.md` with a gap table.
- **CP 2**: Codex config fix applied and verified. `headlessCodexConfig()` emits `multi_agent = true`. Deliverable: code change in `lib/agents/codex.js` + verification evidence in `missions/task-1330/CP-2.md`.
- **CP 3**: Contract decision made and documented. Choice named, rationale cited, upstream sources referenced. Deliverable: contract section in `MISSION.md` or separate doc in `missions/task-1330/`.
- **CP 4**: Prompt and template wiring complete. All five workflow prompts and three agent templates updated with Graphify-first instructions. Deliverable: diffs for each file + verification grep results in `missions/task-1330/CP-4.md`.

## Gates

- [ ] grep -q "multi_agent = true" <(node -e "const c = require('./lib/agents/codex.js'); console.log(c.headlessCodexConfig('/fake'));")
- [ ] grep -rl "graphify" prompts/draft.md prompts/execute.md prompts/review.md prompts/act-on-review.md prompts/portfolio.md | wc -l | grep -q "^5"
- [ ] grep -q "graphify" templates/CLAUDE.md.template
- [ ] grep -q "graphify" templates/AGENTS.md.template
- [ ] test -f "backlog/tasks/task-1330 - Make-Graphify-actually-work-automatically-across-parallix-agents-and-workflow-prompts.md"

## Restricted Areas

- **Do not modify** `templates/MISTRAL.md.template` — Mistral is explicitly out of scope.
- **Do not modify** Graphify upstream files (`/home/magnus/.local/lib/python3.13/site-packages/graphify/`, `/home/magnus/.agents/skills/graphify/`, `/home/magnus/.claude/skills/graphify/`, `/home/magnus/.config/opencode/skills/graphify/`).
- **Do not run** `graphify build`, `graphify query`, or any Graphify pipeline command against the parallix codebase.
- **Do not edit** the backlog task's `assignee` field.
- **Do not delete, rename, or move** the backlog task file `task-1330 - Make-Graphify-actually-work-automatically-across-parallix-agents-and-workflow-prompts.md`.

## Stop Rules

- Stop if the contract decision cannot be justified with a clear preference over the other two options (official always-on, prompt-based, hybrid). Document the indecision and park as a follow-up.
- Stop if `multi_agent = true` is rejected by the installed Codex version as an unknown config key. Document the version mismatch and park as a follow-up.
- Stop if any upstream Graphify installation command (`graphify claude install`, `graphify codex install`, `graphify opencode install`) produces output indicating incompatibility with the current agent versions. Document and park.
- Stop if the prompt updates would cause any single prompt file to exceed 10,000 characters (the description limit for tasks), indicating the Graphify guidance is too verbose for the prompt format. Condense or park as a separate doc.

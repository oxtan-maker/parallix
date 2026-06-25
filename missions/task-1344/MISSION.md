# Mission: Fix draft prompt for Codex compatibility (task-1344)

## Goal
Make the draft prompt template (`prompts/draft.md`) unambiguous enough that Codex (gpt-5.4) performs the drafting workflow correctly — reading the backlog task, filling MISSION.md, and updating labels — without refusing all tool use, while still preventing over-eager agents (Gemini, Qwen) from skipping straight to implementation.

## Why Now
Codex v0.142.0 with gpt-5.4 blocked the entire draft phase for task-1308, producing a "Blocked on conflicting instructions" response instead of generating the mission contract. The same prompt is used by all agents, and the current phrasing (`Mode: draft. No execution.`) is interpreted literally by Codex as a prohibition on all tool execution including file reads and edits. This blocks Codex from participating in the parallix workflow entirely.

## Refinement Signals
- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: broken agent compatibility, narrow scope (one file), high impact on multi-agent coverage

## Scope
- Edit `prompts/draft.md` to replace the ambiguous `Mode: draft. No execution.` header with explicit allowed/forbidden action categories
- Ensure the revised prompt is compatible with:
  - Codex (gpt-5.4): must allow file read/write, graphify queries, and the verification gate
  - OpenCode (Qwen-family): must still prevent trigger-happy implementation
  - Claude: must remain clear and consistent
- Update the backlog task file (task-1344) with the `ai_sdlc` label
- Do not modify any other prompt templates, source code files, or workflow logic

## Out of Scope
- Changes to `prompts/execute.md`, `prompts/review.md`, or any other prompt templates
- Changes to `lib/commands/draft.js` or other workflow source code
- Changes to agent selection logic or adapter configuration
- Testing with actual agent invocations (only static verification via `npm test`)
- Prompt changes for review, execute, or integrate phases

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- The string `Mode: draft. No execution.` does not appear anywhere in `prompts/draft.md` after the change
- `prompts/draft.md` contains explicit "Allowed actions" and "Forbidden actions" sections
- The Allowed actions section includes: read files, write/edit files, run graphify queries/updates, run the verification gate command
- The Forbidden actions section includes: implement mission features, modify source code outside MISSION.md and backlog task, run tests beyond the verification gate, start review/execute/integrate phases
- `npm test` passes with zero failures after the change
- The backlog task file for task-1344 contains exactly one of `ai_sdlc` or `user_value` in its labels frontmatter (specifically `ai_sdlc`)
- `lib/commands/draft.js` line 692 (DRAFT_PROMPT_PATH constant) still references `prompts/draft.md` unchanged

## Risks and Assumptions
- Risk: Redesigning the allowed/forbidden structure might cause Claude or Qwen to behave differently than the original single-line directive. Mitigation: the allowed/forbidden structure is more explicit, which should improve compliance across all agents.
- Risk: Agents might add extra actions not listed in Allowed. Mitigation: Forbidden actions explicitly prohibit implementation, which is the primary concern.
- Assumption: The prompt template is the sole determinant of agent behavior during the draft phase; no other code paths override it.
- Assumption: Codex's refusal was caused by the "No execution" phrase and not by a deeper model-level limitation with the draft workflow.

## Checkpoints
- CP 1: Prompt template rewritten with explicit allowed/forbidden sections
- CP 2: Backlog task label set to `ai_sdlc`
- CP 3: `npm test` passes clean

## Gates
- [ ] ./scripts/verify-local.sh docs
- [ ] npm test

## Restricted Areas
- Do not modify any files under `lib/` (source code)
- Do not modify `prompts/execute.md`, `prompts/review.md`, `prompts/act-on-review.md`, `prompts/portfolio.md`
- Do not modify `templates/vibe/skills/draft/SKILL.md` or `templates/claude-commands/draft.md`
- Do not modify agent adapter configuration in `workflow.config.json`

## Stop Rules
- Stop immediately if `npm test` reports more than zero failures
- Stop if the prompt change would require modifying more than 3 files (current plan: `prompts/draft.md`, backlog task file)
- Stop if any agent documentation (ADR, AGENTS.md, CLAUDE.md) indicates that `prompts/draft.md` is generated from another source that should be edited instead
- Stop if the revision introduces ambiguity about whether graphify commands are allowed (graphify must remain in the allowed list)

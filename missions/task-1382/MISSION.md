# Mission: Update draft and portfolio prompts to use NEL bucket instead of agent-usage % (task-1382)

## Goal

Replace the stale `"Estimated agent % usage limit"` references in the two prompt files (`prompts/portfolio.md` and `prompts/draft.md`) with the NEL bucket format (`Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)`) so that future missions drafted from these prompts produce the correct size signal format.

## Why Now

Task-1379 landed and updated the MISSION.md template (`templates/mission-scaffold.md`) and ADRs to use NEL buckets, but the two prompt files that drive mission proposal and drafting still emit the old `% usage limit` format. Every new mission drafted from these prompts (e.g. task-1378, task-1376, task-1368, etc.) inherits the stale format, creating a cascading drift where dozens of missions reference "Estimated agent % usage limit: 25-50%" instead of the NEL bucket standard. Fixing both prompts in a single mission eliminates the root cause for all future drafts.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: template drift from task-1379, prompt inconsistency causing systemic downstream pollution

## Scope
- Update `prompts/portfolio.md` line 17: replace `- Estimated agent % usage limit (\`n/a\` if not ready)` with a NEL bucket equivalent (e.g. `- Predicted NEL bucket (\`n/a\` if not ready)`)
- Update `prompts/draft.md` "Drafting requirements" section: add an explicit instruction that the Refinement Signals section must use NEL bucket format (`Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)`) and must NOT use "Estimated agent % usage limit"
- No code changes — this is a prompt-only fix touching two markdown files under `prompts/`

## Out of Scope
- Updating existing mission files (e.g. task-1378, task-1376, task-1368) — those are historical artifacts; fixing the prompts prevents further drift
- Modifying the MISSION.md template (`templates/mission-scaffold.md`) — already correct after task-1379
- Modifying ADRs (`docs/adr/0032`, `docs/adr/0036`, `docs/adr/0047`) — already updated by task-1379
- Creating or modifying any source code files under `lib/`

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- **SC1:** `prompts/portfolio.md:17` no longer contains the string `"Estimated agent % usage limit"` — verified by `grep -c "Estimated agent % usage limit" prompts/portfolio.md` returning 0
- **SC2:** `prompts/portfolio.md:17` references NEL bucket terminology — verified by confirming the line contains `"Predicted NEL bucket"` or equivalent NEL bucket phrasing
- **SC3:** `prompts/draft.md` contains an explicit instruction in the "Drafting requirements" section that the Refinement Signals section must use NEL bucket format (`Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)`) — verified by reading the file and confirming the instruction is present
- **SC4:** `grep -r "Estimated agent % usage limit" prompts/` returns 0 matches across all files in `prompts/`
- **SC5:** `npm test` passes with zero failures after the prompt changes (no behavioral regression from prompt edits)

## Risks and Assumptions
- **Risk:** The portfolio prompt output format change may affect downstream consumers that parse the 10-candidate proposal output. **Mitigation:** The NEL bucket format is a drop-in replacement for the `% usage limit` field — same position, same structural role, just different terminology.
- **Risk:** The draft prompt instruction may be ignored by the draft agent if not prominent enough. **Mitigation:** Place the instruction in the "Drafting requirements" section alongside the existing "concrete, non-generic content" rule, using explicit negative phrasing ("must NOT use").
- **Assumption:** The NEL bucket format (`Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)`) is the canonical format agreed upon by ADR 0047 and task-1379.
- **Assumption:** No other prompt files under `prompts/` reference the old `% usage limit` format.

## Checkpoints
- CP 1: Audit all files under `prompts/` to confirm only `portfolio.md:17` and `draft.md` contain stale references — no other prompt files need updating
- CP 2: Update `prompts/portfolio.md` line 17 to use NEL bucket terminology
- CP 3: Update `prompts/draft.md` "Drafting requirements" section with explicit NEL bucket instruction for the Refinement Signals section
- CP 4: Verify `grep -r "Estimated agent % usage limit" prompts/` returns 0 matches
- CP 5: Run `npm test` to confirm no regressions

## Gates
- [ ] ./scripts/verify-local.sh docs
- [ ] npm test

## Restricted Areas
- Do not modify any files outside `prompts/` — the MISSION.md scaffold, backlog task file, and any other files are out of scope
- Do not edit existing mission files under `missions/` — those are historical artifacts
- Do not modify files under `lib/` — static-analysis gate would not be triggered by prompt-only changes, and the task explicitly excludes code changes

## Stop Rules
- Stop if the audit reveals more than 2 files under `prompts/` needing changes — escalate for scope review
- Stop if `npm test` fails due to prompt changes — investigate whether the test suite references prompt content directly
- Stop if the draft.md instruction would conflict with existing instructions in the same section — restructure rather than stack conflicting directives

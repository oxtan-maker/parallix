---
id: TASK-1382
title: Update draft and portfolio prompts to use NEL bucket instead of agent-usage %
status: done
assignee: []
created_date: '2026-06-27 19:09'
labels:
  - ai_sdlc
  - workflow
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

After task-1379 landed (ADR 0047), the MISSION.md template (`templates/mission-scaffold.md`) was correctly updated to use `Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)`. However, new missions like task-1381 still get drafted with the old `Estimated agent % usage limit: 25-50%` format.

Two root causes:

1. **`prompts/portfolio.md:17`** still says `- Estimated agent % usage limit (\`n/a\` if not ready)`. The portfolio prompt (used to propose mission candidates) hasn't been updated to NEL buckets, so it suggests the old format in its output.

2. **`prompts/draft.md`** has no instruction telling the draft agent to use NEL buckets for the Refinement Signals section. The draft prompt says "fill every scaffolded section with concrete, non-generic content" but doesn't specify the NEL bucket format. The draft agent overwrites whatever was in the template with the old `% usage` format.

## Scope

- Update `prompts/portfolio.md:17` to reference NEL bucket instead of agent-usage %
- Update `prompts/draft.md` to include an instruction in the "Drafting requirements" section that the Refinement Signals section must use NEL bucket format (`Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)`) and must NOT use "Estimated agent % usage limit"
- No code changes needed — this is a prompt-only fix

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 prompts/portfolio.md references NEL bucket (not agent-usage %) in its output specification
- [x] #2 prompts/draft.md instructs the draft agent to write NEL bucket format in the Refinement Signals section
- [x] #3 grep "Estimated agent % usage limit" prompts/ returns 0 matches
- [x] #4 Existing missions (e.g. task-1381 in worktree) are not affected — this fix only applies to new drafts going forward
<!-- SECTION:DESCRIPTION:END -->
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [x] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

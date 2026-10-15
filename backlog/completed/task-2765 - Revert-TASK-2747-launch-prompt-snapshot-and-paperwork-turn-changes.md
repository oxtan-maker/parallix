---
id: TASK-2765
title: Revert TASK-2747 launch-prompt snapshot and paperwork-turn changes
status: done
assignee: [codex]
created_date: '2026-10-15 14:08'
labels:
  - ai_sdlc
dependencies: []
references:
  - src/application/agent-launch-context.ts
  - src/adapters/agents/agent-launch-preparation.ts
  - prompts/draft-core.md
  - prompts/execute-core.md
  - prompts/review-core.md
priority: high
ordinal: 252008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Revert the whole of TASK-2747 (commit 394eb1807, "Cut agent paperwork turns in Parallix launch prompts and evidence commands"). The idea was tried and its cost is too high: every agent launch prompt now begins with an uncapped "Authoritative Mission status snapshot" (src/application/agent-launch-context.ts) that inlines the brief, all checkpoints with their evidence, and the entire review history. In the task-2746 transcript the checkpoints alone were 45-74 KB and the review 18-71 KB, growing every round; prompts reached 131-187 KB and hit Linux MAX_ARG_STRLEN (E2BIG), so every argv provider failed in turn until pi.

Scope: undo everything TASK-2747 introduced, including the snapshot and its call in agent-launch-preparation.ts, the matching wording in prompts/draft-core.md, execute-core.md and review-core.md ("no initial px status read is needed"), launch-prompt-context.ts, handoff-controls.ts, the checkpoint-service and mission-writes.ts changes, the pi smoke script, the docs it touched (docs/agents.md, docs/config.md, docs/real-agent-smoke.md) and the tests, fixtures and CPU-budget entries it added. A plain git revert of 394eb1807 on current main conflicts in 17 files (34 later commits touch 31 of the same files), so resolve each conflict by keeping later unrelated work and removing only TASK-2747 behavior. Agents go back to reading mission state with px status.

Out of scope: argv size limits and prompt transport (TASK-2760, TASK-2761); TASK-2761 must be rebased or dropped once this lands because it edits agent-launch-context.ts.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

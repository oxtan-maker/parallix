---
id: TASK-2352
title: Keep execute agents running until the full mission is complete
status: ready-for-integration
assignee: [codex]
created_date: '2026-08-10 08:20'
updated_date: '2026-08-10 08:20'
labels:
  - bug
  - ai_sdlc
  - agents
  - workflow
  - reliability
dependencies: []
references:
  - prompts/execute.md
  - src/adapters/cli/commands/active.ts
  - src/application/execute-mission-service.ts
  - src/adapters/agents/codex.ts
parent_task_id: null
priority: high
ordinal: 72300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`px active` treats an execute-agent process exit as eligible for handoff once any committed `CP-N.md` exists. The execute prompt says to work checkpoint-by-checkpoint but does not make clear that completing one checkpoint must not end the one continuous mission invocation. On TASK-2332.07, Codex committed CP-1, returned a final response, was resumed, and then returned again during CP-2 without a mission stop rule or an external blocker.

Make execution fail closed on incomplete missions with rebounce similar to other errors and make the prompt's terminal condition unambiguous. The execute agent must continue from each committed checkpoint to the next incomplete checkpoint in the same mission invocation; it may finish only after every declared checkpoint and mission gate passes, or after a stated stop rule or a genuine external blocker. A checkpoint that is large must be decomposed into safe slices rather than treated as a terminal condition.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `prompts/execute.md` explicitly states that CP completion is non-terminal: the agent must immediately continue to the next incomplete declared checkpoint and must not send a final response or exit after a checkpoint.
- [ ] #2 The prompt permits termination only when all declared checkpoints and mission-declared gates are complete, a mission stop rule applies, or a genuine external dependency blocks progress; checkpoint size or uncertainty alone is not a valid terminal condition.
- [ ] #3 Pre-handoff validation derives the checkpoint names declared by the active mission's `## Checkpoints` section and rejects handoff when any declared `CP-N.md` is missing, invalid, or uncommitted. The diagnostic lists the missing or invalid checkpoint names.
- [ ] #4 An execute run with only committed CP-1 for a multi-checkpoint mission cannot call `performHandoff` or start the review loop.
- [ ] #5 The relaunch path for incomplete mission progress gives the existing agent a continuation instruction that names the next missing checkpoint and preserves the mission's no-final-until-complete contract, rather than treating the condition as a generic Goal Check repair.
- [ ] #6 Fast hermetic tests cover: a single-checkpoint mission, a multi-checkpoint mission with only CP-1, complete committed checkpoint coverage, malformed checkpoint declarations, and the continuation prompt. No test starts a real agent CLI, Forgejo process, or recursive workflow command.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Focused unit tests for execute prompt, mission checkpoint completeness, and relaunch behavior pass.
- [ ] #2 `./scripts/verify-local.sh all` passes on the final tree.
- [ ] #3 No focused or unannotated skipped tests are introduced.
- [ ] #4 Final checkpoint Goal Check cites the prompt, validation implementation, and exact test names.
<!-- DOD:END -->

---
id: TASK-2386
title: Make agent handoff prompts completion-safe
status: backlog
assignee: []
created_date: '2026-08-21'
labels:
  - bug
  - ai_sdlc
dependencies: []
references:
  - src/application/rebase-workflow.ts
  - src/adapters/agents/pi.ts
  - src/adapters/agents/agents.ts
priority: high
ordinal: 103917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
During TASK-2385 handoff, the custom Pi resolver identified the correct shared-file resolution and announced "Stage + continue", but did not perform the commands or terminate. The handoff waited indefinitely for the agent result.

The workflow prompt must make the terminal condition unambiguous for every agent family: execute the listed commands, verify their result, and give a final completion report only after the rebase and required checks complete. It must not invite a plan-only response. Review all handoff, rebase-conflict, and rebound prompts that require agent-side shell work; reuse a single concise completion contract where suitable.

The no-output watchdog remains observational. It must continue reporting liveness for as long as an agent is running and must never terminate, time out, or otherwise cancel the agent. Visible assistant text must not permanently suppress later liveness reports: an agent can speak, then stall while a tool or session remains active.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every agent-side handoff, rebase-conflict, and rebound prompt that requires commands states: execute the commands now; report completion only after their required verification succeeds; report and stop on a command failure.
- [ ] #2 A focused test proves the shared-conflict resolver prompt directs an agent to execute `git add` and `git rebase --continue`, rather than only inspecting or describing the resolution.
- [ ] #3 The liveness watchdog is observational and continues periodic reporting until the agent result settles; it never kills, times out, or cancels an agent.
- [ ] #4 A focused launcher test covers output followed by a still-running agent, proving later liveness reports continue after the first visible output.
- [ ] #5 `./scripts/verify-local.sh static-analysis` passes.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

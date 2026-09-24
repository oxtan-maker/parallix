---
id: TASK-2563
title: >-
  Draft ends as a hard failure when the agent leaves the mission contract
  incomplete; no bounce-back to the agent and the prompt blurs required vs
  optional fields
status: backlog
assignee: []
created_date: '2026-09-23 09:22'
labels:
  - workflow
  - draft
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 100008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed in task-2561 (px draft task-2561 --agent claude, 2026-09-23, claude session 3db9e492-b0e2-4aeb-b66a-597ddd5cc107).

What happened:
- The drafting agent recorded goal/why and scope (mission version 3), then put the remaining writes (repro, 6 criteria, 4 checkpoints, gate, nel) in one chained Bash call. px status takes ~60s here, and the chain called it once per write via --expected-version $(px status ...), so the call hit the 120s tool timeout and was moved to the background. The agent then ended its turn to 'wait for the notification'; in -p mode that ends the session and the background task was killed.
- finalTransition in src/adapters/cli/commands/draft-stats.ts called recordDraftRefinement, which threw from requireDraftedContract (src/domain/mission-workflow.ts): missing criterion, checkpoint plan, gate, NEL bucket, repro.
- px draft printed [FAIL] and exited. The recovery hint said 'ensure the operator-local database is reachable, then re-run the draft', which is wrong for a MissionRuleViolation: the DB was fine; the contract was incomplete. Re-running the draft starts a new agent from scratch and throws away the partial contract and the agent's research.

General issue:
1. No bounce-back at the draft -> refined boundary. The handoff has a rebound or repair loop. Draft has none. When requireDraftedContract rejects refine, px draft should resume the same agent session (or relaunch it with the recorded state) and pass the exact 'Missing ...' list back. It should use a small bounded budget (for example, 1-2 attempts) before hard-failing. The same applies to any later draft/refined -> active transition where activate re-checks the contract.
2. The failure message does not match the cause. A MissionRuleViolation (incomplete contract) and an infrastructure error (DB unreachable) both get the 'database reachable' repair text. They should be told apart. For an incomplete contract, name the missing parts and give the resume/record command, not 're-run the draft'.
3. The draft prompt (prompts/draft-core.md) states required and optional fields in several places, and they are not the same. The Commands list does not mark which items are required. The 'not complete until' paragraph lists goal, why, scope, criterion, checkpoint plan, gate, NEL and repro for bug missions. 'Drafting requirements' also lists out-of-scope as required ('record a concrete ... scope, out-of-scope, ...'), but another paragraph and requireDraftedContract say it is optional. px repro set is only in the bug section, not in the command list. Put one table or checklist that marks each field as required, required for bug missions, or optional, and make the other sections point to it.
4. The prompt does not warn against ending the turn while px writes still run in the background, and does not suggest recording one fact per call. Both would have prevented this failure. At minimum, add: record each write as its own foreground command, and never finish with commands still running. A slow px status (~60s) called once per write makes a long chain likely to hit the tool timeout.

Out of scope: speeding up px status itself (separate), and pre-draft worktree provisioning (TASK-2562).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When refine is rejected with an incomplete-contract MissionRuleViolation, px draft sends the missing-parts list back to the drafting agent (resumed session or relaunch that keeps recorded state) with a bounded retry budget, and only hard-fails after the budget is used up; covered by a test with a stub agent that completes the contract on the second attempt
- [ ] #2 An incomplete-contract failure prints a repair message naming the missing parts and the commands to record them, separate from the database-unreachable message; covered by a test
- [ ] #3 prompts/draft-core.md has one list that marks every contract field (goal, why, scope, out-of-scope, criteria, checkpoint plan, gates, NEL, repro, depends) as required, required for bug missions, or optional, matching requireDraftedContract, with no conflicting statements elsewhere in the prompt
- [ ] #4 prompts/draft-core.md tells the agent to run each px write in the foreground and never to finish while px commands are still running
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

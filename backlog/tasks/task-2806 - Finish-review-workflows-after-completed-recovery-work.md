---
id: TASK-2806
title: Finish review workflows after completed recovery work
status: backlog
assignee: []
created_date: '2026-10-22 09:52'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 285008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Repeated recovery workflows can leave their outer px review --continue coordinator alive and idle after the repair agent and every verification child have exited. The Mission remains active/reviewing until an operator runs px stop, even when durable checkpoint evidence is ready.

Observed twice on 2026-10-22:
- TASK-2794: the exact integration gate child exited; the review coordinator remained alive for more than five minutes without a child or lifecycle result. px stop task-2794 terminated the idle coordinator; the durable state then resolved to integration.
- px-0016: after the Claude repair agent completed (run:execute-claude-a1-mvjc82ms:stdout@668000+12000) and its Sonar/static-analysis children completed, the coordinator stayed live idle. px stop px-0016 was required before continuation could be retried.

Existing-task search found related completed recovery work TASK-2588, TASK-2665 and TASK-2734, but no active owner for coordinator completion after a successful/no-change diagnostic repair. Do not alter gates, budgets, agent identity, approval authority, or use px stop as normal progression.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A focused parent-red/fixed-green workflow contract reproduces a completed repair agent plus settled gate child whose outer review coordinator fails to finish, then proves the coordinator reaches its durable next lifecycle action without operator px stop.
- [ ] #2 Normal completed repair, failed repair, cancellation and intentional live-gate states remain distinguishable; a live child is never treated as idle or killed.
- [ ] #3 The repair preserves durable checkpoints, review rounds, PR identity, independent approval and integration authority; it does not introduce a duplicate worker, synthetic approval or gate bypass.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
- [ ] #7 Focused owning workflow/recovery checks pass and the relevant declared gate passes without changing gate configuration or CPU budgets.
<!-- DOD:END -->

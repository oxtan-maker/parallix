---
id: TASK-2826
title: Make px review survive client termination and detect orphaned rounds
status: backlog
assignee: []
created_date: '2026-10-31 16:20'
labels:
  - bug
  - harness
dependencies: []
priority: medium
ordinal: 299016
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while restarting review round 3 of px-0021. A review round was lost after the foreground client was killed.

1. Killing a foreground `px review` client (for example by `timeout` sending SIGTERM) leaves the detached review workflow running but later in an unconfirmed `stopping` state (`px status`: `Mission work: (unconfirmed): stopping`, `Coordinator evidence: no live px command`). The reviewer then completed a full review on the local model, but every `px verdict` failed with `Workflow ownership was fenced or stopped`, so the verdict was lost with no retry or hand-off. The reviewer's work (findings, repro scripts) existed only in its session transcript.

2. After that, the round stayed `phase reviewing, disposition none` indefinitely with no live workflow, execute or reviewer process. `px review --status` gave no hint that the round was orphaned, and a second `px review` was refused with `Another workflow owns this mission` until `px stop` cleared it.

Expected: a client disconnect either does not stop the workflow or is stopped deterministically before a reviewer launches. A fenced verdict persist should keep the verdict as retained evidence for the restarted round, and status should report an orphaned round with the exact recovery command (`px stop <slug>`, then `px review`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Terminating the foreground `px review` client does not leave a reviewer running against a fenced workflow
- [ ] #2 A verdict rejected by the ownership fence is retained as evidence and surfaced to the restarted round instead of being lost
- [ ] #3 `px review --status` and `px status` report a round with no live workflow as orphaned and name the recovery command
- [ ] #4 Each fix has a focused regression case in the existing owning suite
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

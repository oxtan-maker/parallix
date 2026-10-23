---
id: TASK-2814
title: Keep failed review workflows visible to px lead
status: backlog
assignee: []
created_date: '2026-10-23 19:50'
labels:
  - bug
dependencies: []
references:
  - >-
    backlog/tasks/task-2799 -
    Keep-human-only-durable-blockers-visible-in-attention.md
priority: high
ordinal: 292008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed on 2026-10-23 with installed px 1.5.444 and px lead running from /mnt/data/code/parallix: five idle review Missions are absent from the board attention queue and therefore never reached by lead: px-0016, task-2785, task-2789, task-2806 and task-2809. Their latest review rounds are reviewing, previous workflows exited non-zero, and each card offers enabled review:submit while active:execute is ineligible (Resuming a review mission requires reviewer findings to act on).

Trace: src/application/projections/board.ts attentionReason prioritizes blocking/gate/stale diagnostics; attentionAction defaults those reasons to active:execute; buildBoardProjection filters out the item because active is disabled. This loses the Mission from attention despite a valid review action. Lead consumes that queue in src/composition/lead-supervisor.ts.

Reproduce in isolated state: construct a review card with blockingReason = Workflow exited with status 1, active disabled, review enabled; buildBoardProjection currently returns no attention item. Confirm equivalent failed-gate and stale-work shapes. Existing owner: test/unit/application/projections/attention-queue.test.ts. A temporary focused reproduction failed on current behavior; all exploratory source/test/doc changes were reverted at operator request. No fix is retained and no live recovery was started.

Related TASK-2799 addresses human-only durable blockers in integration; this ticket covers review workflow recovery with an enabled review command. Reuse existing action/capability ownership; do not assume that every blocked Mission should run active or that every blocker authorizes autonomous continuation. Diagnose and deliver through a separate Mission. Preserve reviewer authority, worker liveness, failure evidence and operator-owned gates. Verify using isolated state; do not mutate live Mission state or statistics.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Retain a focused parent-red/fix-green reproduction in the existing attention-queue suite for an idle blocked review Mission with active ineligible and review enabled.
- [ ] #2 Review Missions with blocking, failed-gate or stale-work diagnostics remain visible with a valid owned next step; preserve reason, priority and source evidence.
- [ ] #3 Board and lead agree on the displayed and dispatched action; preserve valid implementer recovery, live-worker exclusion, unavailable-command rejection and independent review authority.
- [ ] #4 Demonstrate the public lead dry-run against isolated review state; do not launch recovery against live Missions or change gates or budgets.
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

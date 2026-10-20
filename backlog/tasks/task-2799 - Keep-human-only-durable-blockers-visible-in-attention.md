---
id: TASK-2799
title: Keep human-only durable blockers visible in attention
status: backlog
assignee: []
created_date: '2026-10-20 16:06'
labels:
  - bug
dependencies: []
priority: high
ordinal: 278008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A durable human-action blocker can disappear from the board attention queue even though no workflow is live. Reproduced on task-2697 after supported review continuation completed at 2026-10-20T16:00:00Z: Mission remains integration with a stale round-3 approval, clean worktree and no open workflow; reconciled currentWork is null and blockingReason is "autonomous review stopped: implementer reported BLOCKED". /tmp/parallix-lead-monitored-20261020.log reports seven integration handoffs and omits this Mission. Both installed px 1.5.422 and current source lead task-2697 --once --dry-run report no attention.

Precise projection path: attentionReason in src/application/projections/board.ts:275-286 prioritizes blocking over integrate-lane; attentionAction at :300-307 maps blocking through the default active:execute action; active is correctly disabled for an integration Mission. buildBoardProjection at :418-423 then drops the entire attention item because that selected command is disabled, although integrate is enabled and the durable blocker requires operator inspection. This is not stale-operation detection, an infinite retry, or permission to integrate under stale approval.

Read-only production-function reproduction: an approved integration card with no current work queues one integrate-lane item when blockingReason=null. Add only that durable blockingReason: reason becomes blocking, selected action becomes active:execute, active stays disabled and integrate stays enabled, but queue length becomes zero. The explicit existing test "task-2444: queued action is enabled on its card" in test/unit/application/projections/attention-queue.test.ts intentionally filters non-runnable commands. Preserve that safety contract. Surface the blocker through an appropriate human/manual attention representation rather than force-enable or dispatch an invalid lifecycle command. Ordinary integration action must not be presented as resolving a stale-review authority stop.

Deduplication checked native Mission records and Backlog: no matching open ticket. Completed TASK-2444 owns attention queue semantics and TASK-2705 action-control reachability; TASK-2792 owns interruption/ownership, TASK-2798 bounded judgment only after attention selection, and withdrawn TASK-2795 is not an active routing defect. This ticket addresses invisible durable blocking facts, not those separate behaviors.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Retain a focused parent-red/fix-green regression in the existing attention-queue owning suite for an idle approved integration Mission with a durable blocking reason and no valid active command; the blocker remains visible to the operator and lead.
- [ ] #2 Preserve the existing rule that queued executable actions must be enabled; represent manual or escalation attention explicitly without force-enabling active, review or integration to resolve a human authority blocker.
- [ ] #3 Retain ordinary integration handoffs and correct liveness protection. A missing or stale approval must never be silently treated as review authority, and only the operator may stand down an approval.
- [ ] #4 Keep reason, displayed next step and any admitted dispatch consistent across board and lead; preserve durable review/history and do not introduce gate changes, automatic approval, revocation or merge.
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

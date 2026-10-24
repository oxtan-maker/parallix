---
id: TASK-2799
title: Keep durable blockers visible and reachable by lead recovery
status: done
assignee: [claude]
created_date: '2026-10-20 16:06'
updated_date: '2026-10-21 08:35'
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

Read-only production-function reproduction: an approved integration card with no current work queues one integrate-lane item when blockingReason=null. Add only that durable blockingReason: reason becomes blocking, selected action becomes active:execute, active stays disabled and integrate stays enabled, but queue length becomes zero. The explicit existing test "task-2444: queued action is enabled on its card" in test/unit/application/projections/attention-queue.test.ts intentionally filters non-runnable commands. Preserve that safety contract. Surface the blocker through explicit non-dispatchable attention rather than force-enable or dispatch an invalid lifecycle command. Keep it reachable by bounded lead investigation: lack of an eligible lifecycle command or a recorded contract stop must not itself veto diagnosis and authorized recovery. Ordinary integration action must not be presented as resolving a stale-review authority stop.

Deduplication checked native Mission records and Backlog: no matching open ticket. Completed TASK-2444 owns attention queue semantics and TASK-2705 action-control reachability; TASK-2792 owns interruption/ownership, TASK-2798 bounded judgment only after attention selection, and withdrawn TASK-2795 is not an active routing defect. This ticket addresses invisible durable blocking facts, not those separate behaviors.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Retain the owning-suite visibility regression and a parent-red/fix-green lead regression: an idle Mission with a recorded contract stop or no eligible retry remains visible and reaches bounded recovery without lifecycle dispatch. Cover active, review and integration lanes.
- [ ] #2 Preserve executable command eligibility and ordinary blocked-active retry. Non-dispatchable attention offers the concrete px lead <mission> --once next step; lead skips lifecycle dispatch and recursive lead invocation, uses existing recovery ownership, liveness and finite budgets, and verifies progress from later board observations.
- [ ] #3 Retain ordinary integration handoffs and correct liveness protection. A missing or stale approval must never be silently treated as review authority, and only the operator may stand down an approval.
- [ ] #4 Keep reason, displayed next step and admitted dispatch consistent across board and lead. Recovery investigates and repairs within the recorded contract; it cannot change the contract, acknowledge reserved operator stops, revoke approval or merge. Remaining operator decisions require supporting evidence, options and a recommended next step, not a generic instruction to resolve the blocker. Preserve review/history and gate configuration.
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

## Comments

<!-- COMMENTS:BEGIN -->
author: codex
created: 2026-10-21 08:35
---
2026-10-21 recurrence from TASK-2798: after the bounded repair completed, handoff stopped because planned CP-7 is unrecorded. CP-7 requires resolving PR #768 human ADR feedback, judgment-boundary defects, final adapter/session capture and a discriminating matched evaluation. The unresolved choice is whether bounded operator judgment should inspect/action credible live stalled workers, beyond its delivered pre-fresh-recovery admission. The Mission remains lifecycle active with no human-attention action even though an agent must not invent the operator design decision. px history run:workflow-cb62f359-423f-401d-a547-a82146a586bf records Planned checkpoint evidence is missing before handoff: CP-7. Board/CLI should surface this as a distinct actionable human blocker rather than ordinary active repair.
---
author: codex
created: 2026-10-23
---
Operator correction (2026-10-23): visibility must not become a blanket veto on lead recovery. This supersedes the earlier no-recovery contract. Bounded operator judgment policy remains owned by TASK-2798; these items must reach the shared recovery path where that policy is composed. Missing planned checkpoint evidence alone does not establish an operator-only decision; preserve the context for investigation and escalate only a remaining reserved decision. Native Mission goal, scope and criteria were revised through public commands, with correction evidence recorded in CP-6.
---
<!-- COMMENTS:END -->

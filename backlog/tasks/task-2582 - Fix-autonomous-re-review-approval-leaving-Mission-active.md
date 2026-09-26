---
id: TASK-2582
title: Fix all Mission lifecycle transitions and persist state immediately
status: backlog
assignee: []
created_date: '2026-09-26 09:32'
updated_date: '2026-09-26 09:54'
labels:
  - bug
  - review
  - lifecycle
dependencies: []
references:
  - TASK-2579
  - TASK-2397
  - TASK-2514
priority: high
ordinal: 113008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2579 (PR #501) completed autonomous review round 2 with APPROVE, printed APPROVED and “Task task-2579 transitioned to ready-for-integration and committed”, but the authoritative Mission remained active instead of integration.

Observed evidence (operator SQLite database, read-only inspection on 2026-09-26): missions.id=task-2579 has status=active, version=38; mission_review_rounds round 2 has decision_kind=approved, phase=approved, disposition=APPROVED. board_lane_events records active → review at 06:17:26.210Z and review → active (request-changes) at 06:51:57.033Z, with no subsequent review or integration event. Round-2 reviewer_outcome verdict=approve was recorded at 07:09:53.161Z. This is a persisted lifecycle mismatch, not a board rendering issue.

Root cause traced in mission HEAD f1df44731 and confirmed in main 14685f112:
- src/adapters/review/review-round.ts recordRequestedChanges correctly transitions the Mission from review to active.
- The subsequent autonomous reviewer setup in src/adapters/review/review-loop.ts (around lines 411–414) calls transitionTaskFn(slug, review) and persists review bookkeeping, without an authoritative active → review lifecycle transition. transitionTaskLocal in src/adapters/backlog/task-transitions.ts only edits/commits the Backlog task file. Opening the next round therefore leaves the Mission active.
- transitionApprovedReview and replayApprovalTransition in src/adapters/review/review-round.ts silently return null unless mission.status is review. recordApproval can consequently report recorded while leaving an active Mission unchanged.
- The loop approval persistence path does have a lifecycle service supplied by src/composition/review-persistence.ts. However ReviewState.approveLifecycle in src/adapters/review/review-state.ts only reports a non-completed approve transition when the old Mission status is review. The domain approve command requires review (src/domain/mission-workflow.ts), so failure from active is suppressed and persistence reports committed.
- applyReviewerOutcome then prints approval success and transitionVirtualFn updates the Backlog task to ready-for-integration, producing the misleading success message.

Reproduction: start an authoritative review; submit request-changes; record actual implementer fixes/resolutions; let the autonomous loop open round 2 and approve it. Observe an approved review attached to an active Mission and a success message despite no integration lane event.

Fix the authoritative round handoff and approval failure handling, rather than changing board lane inference or widening the domain approve guard. TASK-2397 covers px integrate recovery of active + approved, but does not prevent this normal review-loop failure. TASK-2514 addresses a related manual human approval path; this ticket covers the autonomous multi-round path.

Expanded scope requested by the operator: audit and fix ALL Mission lifecycle transitions across CLI, board-triggered commands, autonomous loops, manual actions, retries, resume and recovery. TASK-2579 is the confirmed reproduction; other affected paths must be investigated, not assumed correct or claimed broken without evidence. Cover every supported transition, including intake/refinement, activation, review handoff and re-review, request-changes, approval/integration queueing, integration completion, cancellation and recovery where supported. Distinguish lifecycle lane from current work: beginning integration work must not mark the Mission done before integration succeeds.

Timing contract: when Parallix accepts a valid transition and begins work belonging to the destination state, persist the authoritative destination state and its lane event directly at that boundary, preferably before launching an agent or starting slow setup, Git operations, verification gates, provider calls or background work. Where direct persistence is not possible, it must complete within the first 200 ms of beginning destination-state work. Measure elapsed time with a monotonic clock from that boundary to successful persistence; do not satisfy the budget by backdating event timestamps or measuring only the database call. Preconditions and authorization must still pass before transition; completed states require actual successful completion. If persistence fails or exceeds the deadline, surface the failure and stop dependent work rather than claiming success. Board/projections must receive the committed change promptly instead of waiting for the agent or command to finish.

Use the existing lifecycle service and domain rules as the authority. Remove or correct file-only status changes, skipped boundary transitions, swallowed errors and delayed state writes wherever this audit finds them. Preserve version checks, idempotency, decision/revision guards and recovery semantics. Record the audited entry points and reproduction evidence in this task/checkpoint, not as a new live documentation inventory.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A real request-changes → fixes → next review round → approve flow moves the authoritative Mission active → review → integration and emits the corresponding lane events.
- [ ] #2 Approval cannot report success or promote the Backlog task when the authoritative lifecycle boundary fails, including when the Mission is active.
- [ ] #3 Add a red-to-green regression using the real lifecycle and review persistence boundaries; cover approval replay without duplicate lane events and preserve unresolved findings guards.
- [ ] #4 The autonomous loop success output and Backlog ready-for-integration status agree with the authoritative Mission integration state.
- [ ] #5 Audit every supported Mission lifecycle transition and all CLI, board, autonomous, manual, retry, resume and recovery entry points; record findings and fix all demonstrated inconsistencies, including TASK-2579.
- [ ] #6 Persist the authoritative destination state and lane event directly at the accepted transition boundary, preferably before destination-state work starts; any unavoidable deferred persistence completes within 200 ms of starting that work, measured end to end with a monotonic clock.
- [ ] #7 Slow agent launches, Git operations, verification gates and provider calls do not delay the state transition; completed states are recorded only after actual completion and all domain preconditions remain enforced.
- [ ] #8 Lifecycle persistence failures or missed transition deadlines are visible and stop dependent work; no success output, Backlog promotion or projected destination state is emitted for an uncommitted transition.
- [ ] #9 Add runnable regression coverage for transition ordering and the 200 ms contract with external boundaries mocked, including multi-round review, retries, resume/recovery and slow downstream work; replay emits no duplicate lane events and stale versions do not overwrite state.
- [ ] #10 Board and other projections receive committed lifecycle changes promptly without waiting for long-running command or agent completion; tests distinguish queue/lane transitions from current work and terminal completion.
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

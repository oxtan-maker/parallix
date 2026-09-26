---
id: TASK-2582
title: Fix autonomous re-review approval leaving Mission active
status: backlog
assignee: []
created_date: '2026-09-26 09:32'
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
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A real request-changes → fixes → next review round → approve flow moves the authoritative Mission active → review → integration and emits the corresponding lane events.
- [ ] #2 Approval cannot report success or promote the Backlog task when the authoritative lifecycle boundary fails, including when the Mission is active.
- [ ] #3 Add a red-to-green regression using the real lifecycle and review persistence boundaries; cover approval replay without duplicate lane events and preserve unresolved findings guards.
- [ ] #4 The autonomous loop success output and Backlog ready-for-integration status agree with the authoritative Mission integration state.
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

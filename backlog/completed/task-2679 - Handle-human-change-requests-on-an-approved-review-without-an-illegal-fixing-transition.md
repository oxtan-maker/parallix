---
id: TASK-2679
title: >-
  Handle human change requests on an approved review without an illegal fixing
  transition
status: done
assignee: [claude]
created_date: '2026-10-07 09:39'
labels:
  - bug
dependencies: []
priority: high
ordinal: 191008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed during autonomous review continuation: Round 1 / 5; persisted human_note round 1 to SQLite; recorded human_note round 1 [human]; then failed with Cannot transition from "approved" to "fixing". The current human REQUEST_CHANGES branch in src/application/review-loop/review-loop.ts calls transitionTo("fixing") for every phase except fixing. Approved is terminal in the adapter state machine. Human feedback reconciliation records the note and consumes its source before attempting this transition, so a retry can lose the pending correction. A safe resolution must respect the explicit operator approval-revocation contract and synchronize the authoritative Review, mission lane, and loop projection rather than simply permitting approved -> fixing. Existing RevokeReviewDecisionUseCase and revokeApprovedDecision provide the relevant boundary. Found while working on TASK-2661; deferred because this crosses approval and lifecycle authority.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Retain a focused red-to-green reproduction in the owning review-loop suite for an approved persisted round receiving a current human REQUEST_CHANGES review.
- [ ] #2 Continuation handles the correction through an authorized approval-revocation path, or stops with actionable revoke-review guidance; it never throws an illegal phase transition or launches an implementer under an effective approval.
- [ ] #3 The authoritative Review, mission lane, and loop projection remain consistent; any failed reconciliation retains the correction for retry instead of consuming it permanently.
- [ ] #4 Cover retry and source deduplication, already-fixing continuation, historical or dismissed feedback, and revocation or persistence failure with focused owning-suite checks.
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

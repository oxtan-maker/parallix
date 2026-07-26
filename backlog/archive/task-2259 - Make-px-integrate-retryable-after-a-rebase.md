---
id: TASK-2259
title: Make px integrate retryable after a rebase
status: backlog
assignee: []
created_date: '2026-07-13 13:39'
labels:
  - bug
  - user_value
  - workflow
  - integration
dependencies: []
priority: high
ordinal: 46000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a mission is rebased onto main after an integration conflict, px integrate --dry-run can read stale task metadata from the base worktree before the squash and fail classification/status checks even though the rebased mission task is valid and locally approved. Preserve the mission worktree task metadata for preflight and provide a supported retry path that does not require a manual squash merge.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After rebasing a review-approved mission onto main, px integrate --dry-run succeeds when the mission task has a valid classification and local approved review-state.
- [ ] #2 Preflight resolves classification and status from the mission worktree until the squash merge has landed.
- [ ] #3 Add regression coverage for the failed-rebase-then-retry scenario.
<!-- AC:END -->

## Codex Pre-Draft

**Goal:** allow a review-approved mission rebased onto main to retry integration without a manual squash, using mission metadata for pre-squash validation and canonical metadata after landing.

**Scope and proof:** create a deterministic failed-rebase-then-retry fixture; trace the metadata source selected by dry-run/preflight; retain the mission-worktree task record through retry; verify valid classification, approval, and status are accepted without weakening unrelated preflight checks.

**Checkpoints:** (1) red retry reproduction; (2) phase-aware metadata resolution and focused tests; (3) dry-run and real-path integration verification.

**Stop rule:** do not bypass approval, classification, dirty-checkout, or merge-conflict preflight; reject retries whose mission record is absent, ambiguous, or inconsistent with the branch.

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

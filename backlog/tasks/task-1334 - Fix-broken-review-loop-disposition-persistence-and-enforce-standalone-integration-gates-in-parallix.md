---
id: TASK-1334
title: >-
  Fix broken review-loop disposition persistence and enforce standalone
  integration gates in parallix
status: backlog
assignee: []
created_date: '2026-06-22 16:38'
labels:
  - workflow
  - review
  - integration
  - self-hosting
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Main is currently broken in standalone parallix: newly added `startReviewLoop` disposition-persistence assertions fail on `main`, and the integration safety story is weaker than intended because standalone parallix does not ship the monorepo `scripts/verify-local.sh` path that several integration-pipeline tests depend on. Investigate and fix the broken review-loop behavior, then harden `px integrate` so landing workflow changes in this repo cannot succeed unless a repo-owned gate covering the workflow suite actually ran.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `npm test` passes on `main` with the review-loop disposition persistence regressions fixed.
- [ ] #2 `startReviewLoop` persists terminal and continue-path dispositions (`PUSHBACK_ALL`, `BLOCKED`, `PARKED`, `CHANGES_MADE`) in review state with deterministic tests.
- [ ] #3 The root cause is documented with the introducing commit(s) and why the existing integration coverage did not catch the break in standalone parallix.
- [ ] #4 `px integrate` no longer relies on unversioned local git hooks or external monorepo-only scripts as the only enforcement path for standalone parallix workflow changes.
- [ ] #5 A repo-owned integration gate for standalone parallix runs during `px integrate` when workflow/parallix areas change and fails the integration before landing if the required suite is red.
- [ ] #6 Tests cover the hardened integration path in standalone parallix, including the case where workflow tests fail and integration is blocked.
<!-- AC:END -->

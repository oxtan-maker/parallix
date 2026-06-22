---
id: TASK-1335
title: Harden parallix self-hosting publish path so broken trees cannot reach main
status: backlog
assignee: []
created_date: '2026-06-22 16:47'
labels:
  - workflow
  - self-hosting
  - integration
  - release
dependencies: []
references:
  - /home/magnus/code/parallix/lib/commands/integrate.js
  - /home/magnus/code/parallix/workflow.config.json
  - /home/magnus/code/parallix/test/review.test.js
  - /home/magnus/code/parallix/lib/review/review-loop.js
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The standalone parallix repo reached `main` in a broken state, but `main` history was squashed into a single initial commit, so mission-level provenance is gone. The highest-value fix is to harden the self-hosting publish/import path itself: any path that updates standalone parallix `main` must prove the exact tree being published passes the required local verification gate, and must fail closed when that proof is missing. This targets the real workflow hole even if ordinary `px integrate` already runs `npm test` for in-repo mission integration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Document every code path that can publish, import, extract, or otherwise update standalone parallix `main`, including any path outside ordinary `px integrate`.
- [ ] #2 For each self-hosting publish path, the exact tree being published must run the configured verification gate for standalone parallix and abort on failure.
- [ ] #3 The verification proof must be tied to the exact published tree, so a green run from a different checkout, different commit, or pre-squash state cannot satisfy the guard.
- [ ] #4 At least one automated regression test proves a broken standalone parallix tree cannot be published to `main` through the self-hosting path.
- [ ] #5 The current `startReviewLoop` disposition persistence regression on `main` is fixed so the hardened guard is demonstrated against a real previously-missed failure mode.
- [ ] #6 The implementation notes explain how squashed-history publication obscured provenance and how the new guard prevents that class of failure from recurring.
<!-- AC:END -->

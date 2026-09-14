---
id: TASK-2505
title: >-
  Mainline integration-gate failures dead-end instead of prompting an agent to
  repair main
status: backlog
assignee: []
created_date: '2026-09-13 14:50'
labels:
  - ai_sdlc
dependencies: []
priority: high
ordinal: 72006
---

## Description

While integrating task-2481, the `integration-suite` gate failed and `px integrate` routed the failure as `mainline` (TASK-MAINGATE-54220809): the base-branch probe reproduced the failure on `main`, so no implementer was bounced and the run ended with "Human action required". No agent was prompted, so every mission stays blocked until a human notices.

Root causes seen in this incident:

1. The `mainline` route in the integration-gate rebound only writes a backlog ticket. Nothing launches an agent to repair `main`, so a red main is a silent dead end for the whole queue.
2. `main` went red without any mission changing the code. `test/review.test.ts` ("verifyReview handles gate failures") pointed its review root at an absolute workstation path (`/home/magnus/code/visualBoard`). When that directory disappeared, the configured gate stopped resolving and the test failed. Tests that depend on the environment drift red without a gate catching them.
3. The base-branch probe runs in the primary checkout, but mission gates run in a linked worktree. Path-dependent tests can give different results in each place. `test/task-2347-01-repository-identity-repro.test.ts` failed only in the primary checkout, because there the checkout's basename (`parallix`) equals the repository id.

The two test bugs are fixed on mission/task-2481. This task covers the systemic routing gap.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A mainline integration-gate failure that is within a budget launches a repair agent against the base branch (or a dedicated repair mission) with the gate evidence, instead of only recording a ticket
- [ ] #2 The mainline repair has its own persisted rebound budget, and it escalates to a human only when that budget is exhausted
- [ ] #3 The mission that detected the mainline failure is re-attempted, or clearly re-queued, once the base branch gate is green
- [ ] #4 The base-branch probe and the mission gate run under equivalent checkout conditions (for example, both in linked worktrees), or the difference is reported in the routing output
- [ ] #5 Test hygiene rejects tests that hardcode absolute workstation paths
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

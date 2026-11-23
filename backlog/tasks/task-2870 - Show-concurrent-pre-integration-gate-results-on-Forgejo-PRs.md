---
id: TASK-2870
title: Show concurrent pre-integration gate results on Forgejo PRs
status: backlog
assignee: []
created_date: '2026-11-23 06:45'
labels:
  - bug
  - ai_sdlc
dependencies: []
references:
  - TASK-2861.01
  - 'http://localhost:3300/magnus/parallix/pulls/934'
  - src/application/review-loop/concurrent-policy-round.ts
  - src/adapters/verification/integration-verification-proof.ts
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Show the result of Parallix's pre-integration gate run directly on the Forgejo PR when it runs alongside agent review under POMDP v2. Show the aggregate integration-tests verdict and enough per-gate detail for a reviewer to see what failed without opening the mission terminal or running px status. The model still receives one integration-tests observation. Static analysis, Sonar and the other configured pre-integration gates are checks within that observation.

Observed on TASK-2861.01 on 2026-11-23. Both agent reviewers approved revision `d40c916fb` on PR #934. The concurrent gate run failed static analysis (cyclomatic complexity 19, limit 15) and Sonar (87.6% new-code coverage, minimum 90%) even though integration-ci and integration-local passed. Parallix recorded the failures and sent the mission back to Active for repair, while the PR showed the approvals with no visible gate result explaining the return.

Publish from the existing integration gate-run record and per-gate outcomes through the Forgejo adapter. Prefer a PR-visible check or status with readable gate details. Use the actual tested revision and run identity so a result remains attributable when the PR head advances, a repair reruns verification, or an older run finishes late. Keep publication within the existing review and gate boundaries.

Scope covers PR visibility for the concurrent verification path. Gate configuration, the POMDP action and verdict semantics, approval coverage, repair routing and landing authority follow their existing rules.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 While pre-integration verification runs alongside agent review, the Forgejo PR shows that verification is pending for the revision being tested. The same PR-visible result settles from the recorded gate run and distinguishes passed, failed and interrupted or cancelled runs.
- [ ] #2 When integration-ci and integration-local pass but static analysis and Sonar fail, the PR shows one failed integration-tests result and identifies both failed gates with actionable details when available. The agent approvals remain independently visible.
- [ ] #3 A rerun can update the result for the same revision. Duplicate publication does not create duplicate entries, a late result from an older run cannot supersede a newer run, and a prior revision result cannot appear as the current PR head verdict.
- [ ] #4 Retain a focused red-to-green reproduction in the owning suite and manually verify a failed concurrent run followed by a passing repair run on a disposable Forgejo PR.
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

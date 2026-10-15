---
id: TASK-2757
title: >-
  Resume failed verification repairs with retained diagnostics and verified
  outcomes
status: done
assignee: [codex]
created_date: '2026-10-15 07:48'
labels:
  - bug
dependencies: []
priority: high
ordinal: 247008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A failed verification gate must rebounce to repair and remain failed until the same required check passes. The unfinished-repair shortcut in src/application/review-loop/review-loop.ts (runOwnedReviewLoop) is identical on main and mission/task-2750: an active Mission with a repair checkpoint lacking evidence launches ordinary act-on-review work and returns on agent exit 0, without resuming the original gate failure or re-verifying. Real TASK-2750 incident 8975417f-aed8-4389-983b-9d7cb579af99 left CP-9 for ./scripts/verify-local.sh all. On 2026-10-15 at 07:16:15Z Codex resumed session 01a13e0c-e61a-7493-acd2-963f46497457 with ordinary review-response instructions, reported no round-5 findings and no failure diagnostic, and exited 0 at 07:17:28Z. Workflow operation 04855ff5-3e22-4a24-a30e-25960206999c was recorded completed. Earlier repair agents also exited normally; this is stranded gate recovery, not evidence of a Codex crash. Retained evidence lives in the mission worktree .workflow/recovery-evidence/task-2750/091a54594a4c4545ae0858f5f6cae2f872d77a19f3acd591b0a68162349c9618/attempt-1.json and canonical .workflow/run-history/task-2750/execute-codex-a1-mv97gagp. Resolve through typed application ports and existing rebound policy, without changing integration test execution.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A focused unit regression reproduces the existing unfinished-repair continuation returning success after a no-op agent exit; the fix resumes the exact retained failed check with diagnostics and bounded rebound policy.
- [ ] #2 Repair launch receives the original command, working directory, retained stdout/stderr references and current repair authority rather than ordinary review-response instructions; missing evidence fails visibly.
- [ ] #3 A zero-exit agent cannot complete recovery: rerun the exact authorized failing check and only continue review or mark success after verification passes. Failed or interrupted repair remains visibly blocked or resumable.
- [ ] #4 Preserve fresh repair session policy, locked contracts, ports-and-adapters boundaries, finite retry budgets, and integration gate commands, ordering, categories and CPU budgets. Extend owning unit suites; do not add or alter integration execution policy.
- [ ] #5 Run focused regression and unit headroom checks, required static analysis, and an isolated manual workflow check without real database mutation or model calls.
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

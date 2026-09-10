---
id: TASK-2481
title: >-
  Hide review-start poll/max-attempts plumbing at default verbosity (task-2477
  follow-up)
status: backlog
assignee: []
created_date: '2026-09-10 14:03'
updated_date: '2026-09-10 14:09'
labels:
  - baseline-red
  - review-loop
  - follow-up
dependencies: []
references:
  - src/adapters/review/review-loop.ts
  - test/task-1209-review-loop.test.ts
  - test/task-2477-review-presentation.test.ts
  - missions/task-2480/MISSION.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two tests on `main` fail because task-2477 landed its assertions but not the corresponding gating for the review-start header lines.

`src/adapters/review/review-loop.ts` emits the `Focus: ... | Max attempts: ...` and `Poll interval: ... | Poll timeout: ...` lines unconditionally in the review-start header, while `test/task-1209-review-loop.test.ts` and `test/task-2477-review-presentation.test.ts` assert those lines are absent at default verbosity.

Failures reproduce on `main` (commit d59bbf3f) with no mission branch applied; `main`'s copies of the source file and both test files are byte-identical to `mission/task-2480` HEAD, so this is baseline-red, not a mission regression.

Failing tests:
- `startReviewLoop skips reviewer and implementer launches for autonomous fallback in provider=none mode` — "default output hides review plumbing"
- `verbose review start exposes poll/provider lines that default hides` — "default off: poll/timeout/max-attempts lines absent"

Discovered during the task-2480 review round after reverting an out-of-scope repair commit (`c48ec6156`, "fix(review): hide polling details by default") that the task-2480 reviewer flagged as scope contamination. That commit's approach — wrapping both `log(fmt.status('INFO', ...))` calls in an `if (verbose)` guard — is the likely fix, but it belongs to this task, not task-2480.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `test/task-1209-review-loop.test.ts` test "startReviewLoop skips reviewer and implementer launches for autonomous fallback in provider=none mode" passes on main
- [ ] #2 `test/task-2477-review-presentation.test.ts` test "verbose review start exposes poll/provider lines that default hides" passes on main
- [ ] #3 At default verbosity, review-start output contains no line matching /Poll interval|Poll timeout|Max attempts/
- [ ] #4 With verbose enabled, the Poll interval, Poll timeout, and Max attempts lines are still emitted
- [ ] #5 `./scripts/verify-local.sh all` passes with no new failures
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Resolved on `mission/task-2480` by commit `ac8cd78ce` ("fix(review): hide review-start polling details by default"), which restores the `if (verbose)` gate on the two review-start header lines.

The fix was not deferred by choice. It was pulled out of the mission branch in response to task-2480 review finding F1 (out-of-scope contamination), after which the pre-review verification gate failed closed on both tests listed above. The gate blocks the mission until they pass and reruns automatically, so the baseline repair had to land in the mission branch rather than in this follow-up.

`./scripts/verify-local.sh all` now exits 0 with 2463 pass / 0 fail. Close this task when task-2480 merges; reopen only if the repair is stripped from that branch again.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

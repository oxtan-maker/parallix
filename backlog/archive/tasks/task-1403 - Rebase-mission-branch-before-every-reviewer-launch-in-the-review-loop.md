---
id: TASK-1403
title: Rebase mission branch before every reviewer launch in the review loop
status: backlog
assignee: []
created_date: '2026-07-02 05:19'
labels:
  - review
  - harness
  - bug
dependencies: []
references:
  - lib/review/review-loop.ts
  - lib/review/rebase.ts
  - 'lib/core/mission-utils.ts:296 (resolveMissionBaseBranch)'
  - 'lib/commands/rebase.ts:117 (already uses resolveMissionBaseBranch)'
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The review loop in `lib/review/review-loop.ts` calls `rebaseBeforeReviewRound()` only on the first reviewer launch of a round (when `!reviewState` at line 779). Between rounds — after the reviewer requests changes, the implementer fixes, and the state transitions back to `reviewing` — the branch accumulates fixes but is never rebased to the latest base branch before the next reviewer launches.

This means a reviewer in round N+1 reviews a branch that may be stale relative to `main` (or the mission's feature-branch base), wasting a review round on conflicts that a rebase would have caught earlier.

The fix is in `lib/review/review-loop.ts` around line 746 (`if (state.phase === 'reviewing')`). Move the rebase call so it fires before every reviewer launch, not just when `!reviewState`. The `px rebase` command already uses `resolveMissionBaseBranch` internally to determine the correct target branch (respecting `Base-Branch:` headers in MISSION.md for feature-branch missions), so the rebase mechanism is already correct — only the call site is incomplete.

**Where to change:**
- `lib/review/review-loop.ts:746` — the `if (state.phase === 'reviewing')` block
- `lib/review/rebase.ts:123` — `rebaseBeforeReviewRound()` (already uses correct branch resolution via `px rebase <slug> --push`)

**Current code path (problematic):**
```
if (state.phase === 'reviewing') {
  if (isContinue && attempt === initialRound) { skip-check ... }
  if (!reviewState) {
    rebaseBeforeReviewRound(...)  // ← only fires here
    // launch reviewer ...
  }
}
```

**Desired code path:**
```
if (state.phase === 'reviewing') {
  // Rebase before EVERY reviewer launch, not just first
  if (!dryRun) {
    rebaseBeforeReviewRound(...)
  }
  if (isContinue && attempt === initialRound) { skip-check ... }
  if (!reviewState) {
    // launch reviewer ...
  }
}
```

The rebase should be skipped in dry-run mode and when a skip-check already found an existing review (since no new launch is happening).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every reviewer launch in the review loop rebases the mission branch to the latest base branch before the agent is launched
- [ ] #2 Feature-branch missions (those with Base-Branch: in MISSION.md) rebase to their feature branch, not main
- [ ] #3 Rebase is skipped in dry-run mode
- [ ] #4 Rebase is skipped when a skip-check found an existing review (no new launch needed)
- [ ] #5 Shared-file rebase conflicts halt the review loop with a clear error message (existing behavior preserved)
- [ ] #6 Existing unit tests pass after the change
- [ ] #7 The change is in review-loop.ts and does not require modifications to rebase.ts or the px rebase command
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

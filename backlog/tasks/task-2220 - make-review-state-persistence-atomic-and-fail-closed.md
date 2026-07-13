---
id: TASK-2220
title: Make review-state persistence atomic and fail closed
status: review
assignee: [codex]
created_date: '2026-07-11 00:00'
labels:
  - bug
  - reliability
  - review
  - guardrail
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`ReviewState.save()` writes `review-state.json`, stages it, and attempts to commit it, but currently returns success even when the commit fails and the file remains dirty. Callers therefore cannot distinguish durable, Git-checkpointed review state from state that exists only in the current worktree. That weakens resumability and can allow the review loop to advance after its recovery record failed to persist.

Make the file write atomic, expose the difference between an unchanged state, a committed state, and a failed persistence attempt, and make lifecycle callers fail closed when a required review-state checkpoint cannot be committed. Preserve benign idempotency: a no-op commit caused by an already-current state remains success.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add a red-to-green regression test proving `ReviewState.save()` / `writeReviewState()` does not report success when `git commit` fails and the state path remains dirty
- [ ] #2 Write `review-state.json` through the shared atomic storage mechanism, or an equivalent temp-file plus rename implementation, so interruption cannot leave partial JSON
- [ ] #3 Distinguish at least these outcomes: state committed, state already current/unchanged, file write failure, Git add failure, and Git commit failure with remaining dirty state
- [ ] #4 Treat a non-zero commit as success only when a subsequent path-scoped status check proves the review-state path is clean
- [ ] #5 Update review-loop and review-command call sites that require durable checkpoints so they stop or return a clear failure instead of continuing after persistence failure
- [ ] #6 Error output identifies the mission, state phase/round where available, failed persistence stage, and underlying Git/filesystem diagnostic without claiming the state was committed
- [ ] #7 Preserve public compatibility where practical; if the boolean return becomes a structured result, provide a deliberate migration for every caller and test helper in the repository
- [ ] #8 Focused tests cover atomic write failure, add failure, dirty commit failure, clean no-op commit, and successful commit
- [ ] #9 Run `./scripts/verify-local.sh static-analysis`, focused review-state/review-loop tests, and the default verification suite successfully
<!-- AC:END -->

## Out of Scope

- Redesigning the review state machine or its phases
- Moving review state outside the mission worktree
- Adding remote persistence or a database
- Refactoring unrelated review-loop orchestration

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

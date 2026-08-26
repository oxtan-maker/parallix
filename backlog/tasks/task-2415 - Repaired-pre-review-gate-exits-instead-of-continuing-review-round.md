---
id: TASK-2415
title: Repaired pre-review gate exits instead of continuing review round
status: active
assignee: [codex]
created_date: '2026-08-26'
labels: [bug, ai_sdlc]
dependencies: []
priority: high
---

## Description

When `rebaseBeforeReviewRound` reports a gate failure, the review loop successfully bounces to the implementer, verifies the repair, and logs `continuing this review round.` It then exits immediately because the `else` paired with `if (rebaseResult.hookFailure)` runs for the original gate-only failure.

Make a successfully repaired typed gate failure continue to the reviewer launch in the same round. Preserve the existing hook-failure path and failure exits. Do not rerun the already verified pre-review setup.

## Acceptance Criteria

- [ ] #1 A gate-only pre-review rebase failure whose rebound repair verifies successfully launches the reviewer and continues the same review round.
- [ ] #2 The regression proves the loop does not call `exit(1)` after logging the successful gate-repair continuation.
- [ ] #3 An unrepaired gate failure and hook-failure recovery retain their current stop/retry behavior.
- [ ] #4 The verified repair does not run the declared pre-review gate a second time before the reviewer launch.

## Scope

- Change the review-loop failure branching and its focused regression coverage.
- Do not alter task-2396's unit-suite concurrency fix or gate budgets.

## Definition of Done

- [ ] #1 The red-to-green review-loop regression passes.
- [ ] #2 The relevant verification gate passes.

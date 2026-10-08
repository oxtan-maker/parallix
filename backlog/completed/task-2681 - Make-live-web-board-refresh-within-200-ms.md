---
id: TASK-2681
title: Make live web board refresh within 200 ms
status: done
assignee: [codex]
created_date: '2026-10-07 13:14'
labels:
  - bug
  - performance
dependencies: []
priority: high
ordinal: 192008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
During TASK-2661 live browser verification against the real repository, board-dependent requests took roughly 4–13 seconds and another request exceeded 15 seconds. Terminal refreshes still timed out during board refreshes after terminal polling stopped rebuilding the whole board. These observations suggest server contention; the precise cause remains unprofiled. Profile the production board read and subscription paths, remove measured bottlenecks and redundant work, and make refreshes complete within 200 ms while missions are running. Work from a separate test host and leave the operator production host running. Preserve current board freshness, invalidation, command validation, and ports-and-adapters boundaries; obtain a separate explicit decision before changing architectural boundaries.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Capture baseline CPU profiles and end-to-end browser refresh timings against the real repository with running missions; identify the measured bottlenecks rather than assuming a cause.
- [ ] #2 A board refresh completes within 200 ms from starting the browser refresh request to displaying the updated board; demonstrate the target across at least 100 consecutive refreshes under representative active-mission load and report median, p95, maximum, repository size, and load.
- [ ] #3 Concurrent board subscriptions and browser refetches do not cause terminal requests to time out or mission dialogs to lose progress; demonstrate responsiveness while the board changes and missions run.
- [ ] #4 Manually exercise the real built web board in Chromium on a separate host: open mission cards, observe actual tmux output through repeated board refreshes, and verify close and reopen; retain timings and visual evidence.
- [ ] #5 Retain focused regression coverage in the existing owning suites and preserve current freshness and command validation contracts; do not meet the target by suppressing updates, displaying stale data as current, or weakening verification.
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

---
id: TASK-2600
title: Prevent concurrent review loops from writing stale rounds
status: backlog
assignee: []
created_date: '2026-09-28 04:11'
labels:
  - bug
dependencies: []
priority: high
ordinal: 131008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed during task-2593 integration recovery: an outer review loop held phase reviewing, round 2 while a nested px review --start completed round 3 with APPROVED. When the outer launcher fell back from qwen to custom, applyAgentFallback updated its in-memory reviewer and persisted the entire round 2 ReviewState. The authoritative Review already held round 3, so applyReviewStateToReview rejected the stale flattened write and integration exited with Review-state persistence failed for mission task-2593, phase reviewing, round 2. The guard correctly prevented history corruption; the failure is that multiple controllers could advance and write the same review without round ownership or reconciliation.

Systematic cause: startReviewLoop keeps one mutable ReviewState across agent launches and the for-attempt loop; applyAgentFallback and other helpers persist that snapshot after asynchronous work. A nested or concurrent review --start can advance the store while the earlier loop remains live. The earlier loop has no ownership fence or current-round check before the next side effect. Integration re-review and agent-issued review commands can therefore race, and a newer approval can be stranded behind an older loops persistence exception.

Fix the workflow boundary: define one authoritative controller per mission review round, make stale round/version writes detect ownership loss before launching or persisting more work, and reconcile or stop the superseded loop without mutating the newer round. Keep the monotonic round guard. Treat reviewer output and verdict submission as data for the controlling loop, rather than allowing a reviewer to launch a competing review loop. Cover integration-triggered re-review and resumed review paths. Include an actionable diagnostic and continuation path when a controller loses ownership.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A regression test reproduces two overlapping review controllers: outer round 2 waits during reviewer launch, another controller advances and approves round 3, then outer fallback occurs; the newer approval and round history remain intact and the outer controller stops or reconciles cleanly.
- [ ] #2 A review round has a single effective controller or equivalent ownership/version fence; nested px review --start and --continue cannot silently create a competing loop for the same mission while one is active.
- [ ] #3 Fallback identity updates, telemetry writes, verdict handling, and other delayed review-state writes re-read or conditionally update the current authoritative round; none applies an old flattened snapshot to a newer round.
- [ ] #4 Integration-triggered re-review recognizes the authoritative round 3 approval and either resumes integration safely or reports a precise operator action, without treating the stale round 2 write as a new review failure.
- [ ] #5 Focused tests cover concurrent start/continue, fallback during a round transition, and preserving the stale-write guard that rejects round renumbering.
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

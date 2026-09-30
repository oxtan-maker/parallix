---
id: TASK-2623
title: Handle missing review resolution immediately after agent exit
status: backlog
assignee: []
created_date: '2026-09-30 18:16'
labels:
  - bug
dependencies: []
priority: high
ordinal: 147008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed on task-2588 / Forgejo PR #539: Codex exited after committing bc9fa62b0 and reporting outstanding review findings, but Parallix then polled for its disposition for at least 300 seconds (configured timeout 600 seconds). The agent process had already finished; Forgejo latency was not the cause. In review-loop.ts, launchImplementerActOnReview awaits the agent, then consumeAndRecoverImplementerArtifacts returns without recovery when consumeImplementerArtifacts reports consumed:false for absent artifacts. The controller proceeds to pollDispositionWithTimeoutRecovery and waits for a disposition that the exited agent cannot produce. Investigate workflow-owned resolution state and provider identity/filtering as well, so an existing valid resolution is not mistaken for missing output. Treat process completion and protocol completion separately: reconcile authoritative output immediately after exit, then recover or escalate promptly when output is absent, preserving unresolved findings and committed work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A deterministic reproduction models an implementer exiting without artifacts or a recorded resolution and proves recovery or explicit escalation starts without a full provider polling timeout.
- [ ] #2 An already-recorded valid workflow resolution is recognized immediately after agent exit, including correct actor and round/revision matching.
- [ ] #3 Missing output never creates a false successful disposition, discards committed fixes, or resolves outstanding findings.
- [ ] #4 Agent completion, missing protocol output, recovery, and escalation are reported distinctly; asynchronous/manual review polling remains supported where required.
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

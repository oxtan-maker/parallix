---
id: TASK-2817
title: Consolidate review progression after TASK-2750 under one application owner
status: backlog
assignee: []
created_date: '2026-10-24 05:29'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 295008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2750 connected CLI review entry to board handoff orchestration without consolidating ownership. On TASK-2789, authoritative Mission status is active while review round 3 is reviewing with no decision. No px command is live. Retrying review reaches handoff:record and fails with Review is not ready to resume before the reviewer runs. Two earlier approvals were revoked by integration failures; the outstanding dependency audit is a separate blocker and must not be disguised as successful recovery.

Confirmed code/history: commit d22332f96 (bundled TASK-2750 and unrelated classifier work) added workflowKind in src/composition/workflow-cli.ts, routing an active Mission to handoff:record based on its lane. src/composition/production-capabilities.ts resumeActiveBoardHandoff independently resolves findings, selects/begins review rounds, saves state and transitions the Mission; it rejects an already-awaiting-review conversation. That restriction predates TASK-2750. Meanwhile src/application/review-loop/review-loop.ts continuesActiveHandoff explicitly recognizes active plus awaiting-review as resumable. test/unit/application/projections/board-handoff-resume.cases.ts currently preserves the rejection instead of proving a common entry contract.

Restore the accepted architecture in ADRs 0037, 0051 and 0053: one application-owned review entry/orchestration path, shared by CLI, board and automatic recovery; pure legal-transition rules in domain; effects behind application-owned typed ports; composition only assembles dependencies. Inspect and consolidate around the existing ReviewRoundUseCase, review loop, handoff and Mission lifecycle owners. Remove competing progression implementations and superseded tests while preserving distinct behavioral assertions. Do not add another resume handler, compatibility wrapper, interface-specific state machine or retries that hide the refusal. Review and Mission state changes that must agree must use the existing atomic/concurrency-checked authority.

Retain TASK-2750's useful capabilities: durable operation admission and exclusive ownership, stale-owner fencing, independent execution and retained capture across browser disconnect/web-host restart, early authoritative preparing visibility, and safe stop/replacement. Do not blanket-revert the bundled commit, remove its migration, bypass ownership, or let application review continuation become a second process supervisor.

Coordinate with TASK-2810 (review entry and flag simplification) at the shared application entry; TASK-2806 owns coordinator completion after repair, and TASK-2814 owns attention/lead discoverability. This new task owns the conflicting review progression and composition-level policy demonstrated by TASK-2789, not those separate symptoms. Reconcile current integrated and in-flight owners before editing; do not create parallel implementations. Keep dependency vulnerabilities and resource exhaustion outside this task's implementation scope.

Use isolated fixtures and existing public interfaces for manual end-to-end validation. Do not mutate live Missions, reviews, provider resources or statistics. Preserve independent approval, exact failed-check verification, evidence readiness, explicit operator acknowledgment and human integration authority. No architectural principle change, operator-owned gate change, added verification gate or budget increase is authorized. Read ADR 0057 before test selection; extend owning suites, keep unit cases within 500 ms headroom and changed integration suites within 3.5 seconds. Do not add a new E2E suite or rerun full gates as ritual. Update concise live documentation only for changed public behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Retain a focused parent-red/fixed-green reproduction of TASK-2789: active Mission, existing round awaiting review with no current decision, no live owner, and retained integration-repair history. A supported review entry reaches the authorized next application action rather than Review is not ready to resume; unresolved evidence or original-check failures remain explicit blockers.
- [ ] #2 CLI, board and automatic recovery delegate review progression to the same existing application owner through typed contracts. Domain owns pure transition legality; composition and interfaces contain no independent round advancement, reviewer selection or lifecycle sequencing. Production callers use the consolidated path and superseded progression code is removed.
- [ ] #3 Extend owning suites to compare supported entry points for first handoff, interrupted pending review, findings/resolution, retained repair success/failure, human intervention and already-approved state. Preserve distinct assertions and prove no duplicate round, duplicate lane event, fabricated approval or skipped verification.
- [ ] #4 Preserve durable admission, exclusive mission ownership and stale-writer fencing, browser-independent execution/capture, authoritative preparing visibility, and safe stop/replacement. Review consolidation neither bypasses WorkflowOperation ownership nor adds a competing process owner.
- [ ] #5 Related Review and Mission mutations use existing atomic and expected-state/version checks; stale or competing callers cannot leave a partially advanced conversation or overwrite a newer owner. Retain existing cancellation and failure cleanup contracts.
- [ ] #6 Manually exercise the built production CLI and board/application entry end to end with isolated operator state and safe boundary doubles, including the TASK-2789 shape and a blocked original check. Record executable revision, commands, observed authoritative outcomes and cleanup; leave live data and statistics untouched.
- [ ] #7 Reconcile overlapping TASK-2810 changes, preserve TASK-2806/TASK-2814 ownership boundaries, and document only changed public behavior. Focused verification and required static checks pass without gate, tier or CPU-budget weakening.
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

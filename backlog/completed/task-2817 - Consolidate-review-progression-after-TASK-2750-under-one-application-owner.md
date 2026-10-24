---
id: TASK-2817
title: Consolidate review progression after TASK-2750 under one application owner
status: done
assignee: [claude]
created_date: '2026-10-24 05:29'
updated_date: '2026-10-24 05:31'
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

Mandatory removal and ownership guardrails (operator instruction): this is consolidation and deletion work, not permission to add a parallel solution. Before implementation, trace every production CLI, board, automatic review and repair entry to its current owner; record competing decision/transition sites in checkpoint evidence. Migrate all affected callers to the shared application owner, then delete superseded orchestration, exports, switches, dead branches, seams and obsolete tests. A new wrapper over both implementations, renamed duplicate, feature-flagged fallback, catch-and-retry workaround, or dormant legacy path fails acceptance. Keep legitimate domain rules and effect adapters; do not delete unrelated working capabilities to make checks green.

Completion is refused while a known in-scope review progression defect, competing production owner, unmigrated caller or obsolete implementation remains. Do not defer those defects to follow-up tasks or describe them as out of scope after discovery. Preserve distinct behavioral assertions when removing redundant tests, and replace the test asserting rejection of a valid pending-review resume with the correct shared contract. Extend existing architecture/contract suites where appropriate without introducing new verification gates or weakening exceptions to permit the implementation. Final evidence must identify what was removed, demonstrate caller convergence and show production-composed behavior; source placement, passing import checks, mocks that bypass the real entry, or an agent completion claim alone are insufficient. Any genuinely separate blocker must be reported with evidence and prevents claims that its workflow passed.
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
- [ ] #8 All affected production entry points are traced and migrated; superseded review progression code, exports, dead branches, fallback routes, test seams and redundant tests are deleted. No parallel owner, renamed duplicate, wrapper retaining competing algorithms, feature-flagged legacy path or catch-and-retry workaround remains.
- [ ] #9 Existing owning architecture/contract suites demonstrate that production CLI, board and automatic recovery converge on the shared application review entry and cannot independently advance review/lifecycle state in composition or interfaces. Preserve distinct behavioral assertions and existing gate configuration; import-only checks do not satisfy this criterion.
- [ ] #10 Final checkpoint and review evidence enumerate removed competing paths and migrated callers, cite focused behavioral and production-composed manual results, and identify any remaining defects honestly. No known in-scope ownership/progression defect is deferred to a follow-up or accepted as residual debt; implementation is not complete while one remains.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Confirmed guard blind spot: scripts/architecture/boundary-guards.ts findWorkflowOwnershipViolations scans src/adapters only; allowedDependencyGraph permits composition imports from all inner/outer production layers for wiring. compositionOwnershipViolations checks complete-graph construction and dynamic service lookup, not lifecycle sequencing in composition. scripts/architecture/workflow-ownership.ts detects a finite catalogue of adapter control calls under branches, not duplicate domain/application review algorithms. The existing board-handoff-resume case expects rejection of a pending review. Extend the existing owning architecture/behavior suites to cover this concrete escape and production caller convergence; do not add a verification gate or treat a larger name blacklist as proof of single ownership.
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

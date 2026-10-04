---
id: TASK-2644
title: Resume integration after unchanged transient gate retry passes
status: done
assignee: [codex]
created_date: '2026-10-04 09:15'
labels:
  - bug
dependencies: []
priority: high
ordinal: 162008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An unchanged successful retry of a transient integration gate systematically fails to resume integration.

Observed on task-2637.04 at fc3ddb721a9eaf6bf40d7b710bfbf84b2fb4a44f: agent-smoke failed with missing final checkpoint Goal Check evidence, the unchanged retry passed all repository gates, the route reported that the existing approval still covered the revision, then integration aborted with "Mission task-2637.04 cannot resume integration from active."

Source investigation confirms the same path on main:
- src/application/integrate/gates.ts reactivates the mission through rebound-to-active before routing the failed gate.
- src/application/rebound-kernel.ts retryTransientVerification returns fixed with attempts=0 when the unchanged retry passes.
- src/adapters/cli/commands/integrate-gate-rebound.ts routeFixedIntegrationGateRebound returns route=fixed for an unchanged revision without restoring lifecycle state.
- src/application/integrate/gates.ts subsequently requires mission.status=integration and aborts while the mission remains active.
The initial lifecycle rebound also withdraws local approval, so merely removing the status guard or directly writing the lane would bypass review authority. Resolve the inconsistency between retry timing, approval coverage, and authoritative lifecycle state.

Scope: shared integration gate recovery, including transient e2e failures; the original stochastic Goal Check failure is separate. Extend the existing integrate-gate-rebound-and-repair-contract owning suite with a focused in-process regression using real lifecycle state and mocked gate/provider boundaries. Existing changed-revision repair coverage does not establish the unchanged retry contract.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An approved mission whose integration gate fails transiently and passes on retry with unchanged approved revision continues the same integration invocation through the normal landing path, without an implementer launch or spurious active-lane refusal.
- [ ] #2 The mission lifecycle, local approval coverage, provider approval and Backlog status remain consistent; recovery uses authoritative lifecycle/application ports and does not bypass status or approval guards.
- [ ] #3 A focused regression in the owning integration gate rebound contract suite reproduces red on parent behavior and green with the fix, exercising the outer gate step, retry route and real mission lifecycle together.
- [ ] #4 Changed revisions, dirty/unverified trees, stale or revoked approvals, and exhausted/failed retries retain required review or fail-closed behavior; an unchanged SHA alone cannot restore invalid approval.
- [ ] #5 Existing SHA-keyed gate validation remains tied to the verified revision, and focused contract checks plus required static analysis pass.
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

---
id: TASK-2839
title: Consolidate orphaned review recovery across web and CLI
status: done
assignee: [codex]
created_date: '2026-11-04 06:10'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 309016
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2830 exposed split recovery ownership after review round 10 exhausted its autonomous attempt window. The browser Stop run action successfully settled the workflow: retained tmux history showed every coordinator and agent exited/stopped and only the interactive bash pane remained. Nevertheless status unconditionally instructed the operator to run px stop task-2830 and then px review task-2830. A repeated CLI stop would be a no-op because WorkflowOperationService.stop already returns success when no open operation exists. The remaining block was the Review aggregate human escalation MAX_ATTEMPTS. Direct px review could acknowledge it and grant the shared resumed attempt window, while the browser review path had no operatorResume capability and stopped before the same ReviewRoundUseCase could proceed.

Consolidate these paths behind one application-owned recovery decision and effect boundary. The owner must distinguish workflow shutdown settlement from Review contract-stop acknowledgment, decide whether stop is still required, authorize operator resume consistently, and calculate the resumed review attempt window once. Web and CLI should translate identity/capability and render the result; neither presentation should own a parallel recovery policy. Preserve the rule that automatic, borrowed, nested and integration-owned work cannot synthesize a human acknowledgment.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reproduce the TASK-2830 shape with retained review phase reviewing, humanEscalationReason MAX_ATTEMPTS, no live workflow/coordinator/execution/reviewer, and a previously settled browser stop. Status and board guidance must not ask for another stop; a repeated stop remains harmless and is not required for recovery.
- [ ] #2 One application owner returns the required recovery action from authoritative workflow settlement, Review intervention and liveness facts: stop-and-confirm when owned effects remain, operator-acknowledge-and-resume when shutdown is settled, or refuse with evidence when absence is unconfirmed. Remove duplicated or unconditional presentation policy.
- [ ] #3 Direct CLI review and an explicitly authenticated browser operator-resume action invoke the same typed acknowledgment and Review continuation owner. Both clear only supported human stops, preserve review/history evidence, and use the same resumed attempt-window calculation and round persistence semantics.
- [ ] #4 Automatic lead work, nested/borrowed registries, integration-owned review and unauthenticated browser requests cannot acknowledge a human-only stop or manufacture extra rounds. Existing capability, identity, approval, finding and intervention guards remain fail-closed.
- [ ] #5 Web Stop run reports completion only after the shared workflow stop owner confirms effects settled. Once settled, browser and CLI projections agree that no open workflow exists; pending or unconfirmed termination retains concrete history/process-identity guidance.
- [ ] #6 Extend the existing owning suites for WorkflowOperationService, ReviewRoundUseCase, review operator resume, status/read projection and web command dispatch. Include red-on-parent coverage for the misleading second-stop instruction and the web/CLI resume asymmetry; do not create parallel task-specific suites.
- [ ] #7 Update operator guidance for the consolidated recovery action and distinguish stopping execution from acknowledging a Review contract stop. Preserve ports-and-adapters dependency direction, typed ports, composition authority, configured gates and CPU budgets.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
- [ ] #7 Focused owner tests pass and the TASK-2830 stopped-tmux/MAX_ATTEMPTS reproduction is green.
- [ ] #8 Static analysis and lint pass for every changed file.
- [ ] #9 No duplicated recovery decision remains in web or CLI presentation code.
<!-- DOD:END -->

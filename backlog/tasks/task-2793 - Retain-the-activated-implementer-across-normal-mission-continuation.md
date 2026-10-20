---
id: TASK-2793
title: Retain the activated implementer across normal mission continuation
status: backlog
assignee: []
created_date: '2026-10-20 03:20'
labels:
  - bug
dependencies: []
priority: medium
ordinal: 274008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Choose the implementer once at activation and retain that family for normal mission continuation, including a new px active invocation after stop/restart, review responses, and integration repair. An explicit operator override may change it. Preserve existing blocked-agent recovery and failover; this task must not pin launches in a way that disables that path.

Investigation context (2026-10-20): task-2773.06 was drafted with --agent codex at 02:25 UTC, but its activation at 02:32 UTC had requestedAgent=null, previousAssignee=null and selected custom. The tmux log begins with Implementer: custom; subsequent continuation and integration repair also used custom. Codex has no current blocklist entry. This incident does not establish a Codex-to-custom tracking-loss fallback; the drafting choice and activation choice were separate.

A separate continuity gap was found in source: WorkflowOperationService.prepareAdmission selects request.agent ?? _selectAgent() for every active:execute, ignoring an existing mission assignee, and ExecuteMissionService.execute selects request.agent or agentExecution.select without consulting the existing assignee. Revalidate both paths on the implementation tree, reuse the authoritative mission owner, and ensure admission and execution do not independently reroll the chosen family. Do not change drafting-agent semantics as part of this fix.

Preserve ports/adapters boundaries, block classification, retry budgets and operator-owned verification gates. Extend the existing workflow-operation and mission-execute service contract suites with a focused parent-red/fix-green reproduction; verify manually through an isolated public workflow without mutating operator missions or statistics. Follow ADR 0057 and repository CPU/time limits.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 First activation without an explicit implementer selects an eligible family once, persists it, and launches that same family without an independent reselection.
- [ ] #2 Normal continuation, including stop/restart followed by active without an override, review fixes and integration repair, reuses the authoritative implementer while it remains eligible.
- [ ] #3 An explicit operator implementer override is respected and the actual launched family remains authoritative for subsequent work.
- [ ] #4 Existing blocked-agent recovery still selects an eligible fallback and records the replacement implementer; block classification, retry budgets and gates are unchanged.
- [ ] #5 Owning contract suites retain a parent-red/fix-green reproduction and assertions for initial selection, continuation, explicit override and blocked-agent fallback; an isolated manual workflow confirms continuity.
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

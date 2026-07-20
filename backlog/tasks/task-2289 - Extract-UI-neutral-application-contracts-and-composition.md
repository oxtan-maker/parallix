---
id: TASK-2289
title: Extract UI-neutral application contracts and composition
status: backlog
assignee: [codex]
created_date: '2026-07-20 00:00'
labels:
  - architecture
  - application
  - refactor
dependencies:
  - TASK-2278
references:
  - docs/adr/0051-ui-neutral-application-boundary.md
  - lib/commands/stats-backfill.ts
  - lib/commands/active.ts
  - test/stats-backfill.test.ts
  - test/active.test.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Blocked prerequisite: this mission must not enter `px draft` or `px active`
until (1) TASK-2278/ADR 0051 is integrated and (2) a human explicitly approves
the ADR decision and this proposed implementation breakdown. An automated
review verdict, agent assertion, or passing documentation gate is not that
approval.

Create the minimal application contracts and declared effect ports required by
ADR 0051's selected `stats-backfill` query and `active` execute-launch command.
Create a composition root that is the only location to assemble all concrete
filesystem, Git, task-Markdown, agent/subprocess, configuration, stats, and
handoff adapters. Do not move CLI parsing or rendering into the application
layer. Do not delegate CLI handlers in this mission; TASK-2290 does that after
these contracts land.

Treat `lib/commands/stats-backfill.ts`, `lib/commands/active.ts`,
`lib/tools/backlog.ts`, `lib/core/git.ts`, `lib/agents/agents.ts`, and
`lib/commands/stats.ts` as behavior inventory, not an invitation to refactor
them. Production changes belong in a bounded `lib/application/`, explicit
adapter wrappers, one composition root, and the smallest export-only legacy
edits needed to wrap existing behavior. Candidate tests include new fast
mocked-port, composition, contract, and import-boundary tests under `test/`.
No test may contact Forgejo, launch an agent, recurse into `px`/the verifier,
or invoke an expensive external CLI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Application-owned request/result, read-projection, progress/event, typed-error, cancellation, and capability contracts encode every ADR 0051 rule: one terminal outcome, source/staleness-labelled projections, ordered operation IDs, safe cancellation boundaries, and capability rejection before mutation
- [ ] #2 The `stats-backfill` and `active` application services are executable with fake ports; every contract variant has a positive or negative unit test, so this mission cannot pass by adding unused interfaces or type-only scaffolding
- [ ] #3 Consumer-owned ports expose only operations actually called by the two services; no catch-all dependency bag, optional function collection, generic command executor, framework type, database row, or legacy module object crosses the application boundary
- [ ] #4 Adapter wrappers translate current task-Markdown, Git, agent/subprocess, stats, configuration, and handoff behavior without moving authority or policy; application tests fail on unexpected port calls
- [ ] #5 A single composition root is the only production module that assembles a complete concrete service graph; a repository-wide wiring test rejects complete adapter construction or service-locator access anywhere else
- [ ] #6 Import-boundary enforcement rejects direct and transitive Ink, React, HTTP, SQLite, `node:fs`, Git, Forgejo, `node:child_process`, process-exit, and terminal-rendering dependencies from application/domain code; violation fixtures prove the guard fails rather than merely scanning the happy tree
- [ ] #7 Failure-path tests prove no mutation port is called after validation/capability rejection, progress never becomes durable authority, adapter failures cannot become `completed`, and cancellation after a durable action reports partial evidence instead of claiming rollback
- [ ] #8 A reproducible, read-only bug-frequency report counts only unique missions under `backlog/completed/`, implements ADR 0051's exact-label calculation with configurable creation-date bounds, reproduces the 2026-06-22 through 2026-07-20 baseline of 129 completed / 39 bug / 90 non-bug, excludes every open/archive store, and has disposable-fixture tests for duplicate completed copies, labels added later, unambiguous malformed-frontmatter warnings, and fail-closed ambiguous classification
- [ ] #9 Existing selected handlers remain direct and behavior-equivalent in this mission; characterization tests pin current public text/JSON/exit behavior before TASK-2290, and no workflow/task/mission state is written by these changes
- [ ] #10 New or changed boundary code contains no placeholder implementation, default-success branch, empty catch, `TODO`/`FIXME`, `@ts-ignore`, unjustified `as any`, focused/skipped test, or dead exported contract
- [ ] #11 Focused contract/guard tests, `./scripts/verify-local.sh all`, and `./scripts/verify-local.sh static-analysis` pass on the final tree
- [ ] #12 Rollback deletes the application/port/adapter/composition/report additions and restores the tiny legacy exports without persisted-state, CLI, or authority migration
<!-- AC:END -->

## Implementation Plan

1. Capture current handler behavior and write a contract-to-ADR/test matrix before adding production modules.
2. Define executable services and the minimum consumer-owned ports; test validation, capability, cancellation, failure, and progress semantics with strict fakes.
3. Wrap existing behavior without moving workflow authority; keep `transitionTask` and task Markdown/Git paths behind adapters.
4. Add the one composition root plus self-testing import/wiring guards.
5. Add and fixture-test the bug-frequency report, then run focused and repository gates.

## NEL Estimate

Medium (200–235 NEL): executable contracts, narrow ports, adapter/composition
wiring, bug-frequency reporting, and mocked negative guard tests. Stop and
split before implementation if the refined estimate exceeds 235 NEL or if
concrete wiring requires an unrelated command family.

## Agent-completeness guardrails

- A file or exported type is not evidence of implementation. Each contract and
  port method must be reached by a named test that asserts its observable
  result and its forbidden side effects.
- Mocks must reject unexpected calls. A test that returns canned success
  without asserting call order, arguments, and absence of forbidden mutations
  does not satisfy an acceptance criterion.
- Boundary and composition tests must include violation fixtures that are
  expected to fail the guard. A green scan of only compliant source is
  insufficient evidence that enforcement works.
- Do not copy lifecycle policy into adapter wrappers, add a service locator, or
  pass the old command dependency object through a nominal port.
- Stop for human direction if correct implementation needs new persistence,
  changes task/Git authority, changes CLI output/exit codes, weakens a fail-
  closed path, or requires production edits outside the two selected slices.

## Rollback

Remove the newly introduced application, port, adapter-wrapper, composition, and test files as one revert. Do not modify task Markdown, Git-owned mission state, CLI text/JSON/exit codes, lifecycle policy, or authorization policy.

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Approval prerequisite is recorded and satisfied before work begins
- [ ] #2 The contract-to-ADR/test matrix has no unimplemented or untested row
- [ ] #3 Unit tests use strict mocks only and never reach real Forgejo, agents, network, nested `px`, or expensive commands
- [ ] #4 Negative fixtures prove import, wiring, and forbidden-side-effect guards fail closed
- [ ] #5 The two CLI handlers remain direct pending TASK-2290 and characterization tests prove no public behavior changed
- [ ] #6 The bug-frequency command reproduces the ADR baseline and does not mutate backlog files
- [ ] #7 Changed-line hygiene and required verification commands pass on the final tree
<!-- DOD:END -->

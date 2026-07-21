---
id: TASK-2290
title: Delegate bounded CLI slices through application boundary
status: done
assignee: [codex]
created_date: '2026-07-20 00:00'
labels:
  - architecture
  - cli
  - refactor
  - testing
  - user_value
dependencies:
  - TASK-2278
  - TASK-2289
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

Delegate exactly two CLI handlers to the approved application contracts:
`stats-backfill` for the read/projection slice and `active` for execute-launch
lifecycle orchestration. Retain the current CLI as input parser, renderer, and
exit-code mapper. Preserve `stats-backfill` text, JSON, and `--apply` behavior;
preserve `active` text and exit codes and explicitly preserve that it does not
support `--json`. Do not implement Ink, web, HTTP, SQLite authority, or a
canonical-record migration.

Candidate production files: `lib/commands/stats-backfill.ts`,
`lib/commands/active.ts`, `lib/index.ts`, `lib/tools/backlog.ts`,
`lib/commands/stats.ts`, `lib/agents/agents.ts`, and the application modules
created by TASK-2289. Candidate tests: `test/stats-backfill.test.ts`,
`test/active.test.ts`, `test/index.test.ts`, plus TASK-2289's import-boundary
test. Existing baseline names are `"statsBackfill supports help, json output,
summary output, and apply mode"` and `"active() exits with agent status when
execute agent returns non-zero"`.

Delegation means every in-scope orchestration path crosses the application
service. Leaving a new service beside a still-authoritative legacy happy or
error path is incomplete. The handlers may parse input, render the returned
result, and map it to the existing exit code; they may not retain shadow
lifecycle decisions or call mutation helpers around the service.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Before rewiring, characterization fixtures capture exact stdout, stderr, JSON value shape, exit code, writes, and ordered collaborator calls for every selected success and failure path; after rewiring the same fixtures pass without weakened assertions or broad snapshot replacement
- [ ] #2 Every in-scope `stats-backfill` path delegates computation through the application service: help stays a CLI-edge concern, report-only performs no write, `--apply` writes only after projection, skipped/malformed records remain represented correctly, and write failure cannot print or return success
- [ ] #3 Every in-scope `active` path delegates lifecycle orchestration through the application service while preserving preflight and usage rejection, agent selection/launch, launch-callback record ordering, status/assignee rollback on throw and nonzero return, stats and handoff sequencing, deferred worktree synchronization, and exact nonzero exit propagation
- [ ] #4 Handler tests prove no shadow path calls task-transition, Git, stats-write, handoff, or agent-launch helpers outside the composed service; application tests prove the required port call order and absence of later calls after each failure
- [ ] #5 CLI equivalence covers `stats-backfill` help/text/JSON/report-only/`--apply`/skips/failures and `active` success, usage limit, preflight rejection, launch throw, launch nonzero, rollback failure, handoff failure, cancellation before launch, cancellation after durable transition, and unsupported `active --json`
- [ ] #6 Typed results cannot be flattened: `rejected`, `failed`, and `cancelled` remain distinct, adapter exceptions never map to `completed`, exactly one terminal progress event is emitted, and durable partial evidence is returned when rollback is unsafe or fails
- [ ] #7 Capability checks occur before every mutation port and stale/conflict results perform no mutation; tests use strict mocks that fail on any unexpected external call
- [ ] #8 CLI handlers retain parsing, text/JSON rendering, stdout/stderr choice, and exit mapping only; application/domain modules contain no `process.exit`, console/terminal rendering, CLI argument parsing, environment-specific framework types, or direct infrastructure imports
- [ ] #9 TASK-2289's import/wiring violation fixtures remain green, complete concrete wiring remains confined to the composition root, and no service locator or command dependency bag bypasses the declared ports
- [ ] #10 The final checkpoint records the exact bug-frequency command and the integration-boundary cohort instruction from ADR 0051; it reports the baseline only and makes no unsupported post-change reliability or speed claim
- [ ] #11 New or changed boundary code contains no placeholder implementation, default-success branch, empty catch, `TODO`/`FIXME`, `@ts-ignore`, unjustified `as any`, focused/skipped test, deleted compatibility assertion, or dead legacy orchestration copy
- [ ] #12 Focused equivalence/negative tests, `./scripts/verify-local.sh all`, and `./scripts/verify-local.sh static-analysis` pass on the final tree
- [ ] #13 Rollback restores the previous two handler implementations and removes delegation-only modules without persisted-state, lifecycle, authorization, text/JSON, or exit-code changes
<!-- AC:END -->

## Implementation Plan

1. Build a branch/path inventory for both handlers and add red characterization gaps before changing orchestration.
2. Rewire `stats-backfill`, then prove read-only/apply ordering and exact output equivalence.
3. Rewire `active` in lifecycle order, proving each rollback, partial-state, cancellation, and handoff path before removing its legacy orchestration.
4. Add no-bypass assertions and rerun TASK-2289's self-testing boundary/wiring guards.
5. Audit changed code for placeholders, dead paths, weakened assertions, and recursive/heavy tests; run focused and repository gates.

## NEL Estimate

Medium (200–235 NEL): two bounded delegations plus exhaustive equivalence,
failure-ordering, and no-bypass coverage. Stop and split before implementation
if the refined estimate exceeds 235 NEL or either path needs unrelated
lifecycle, persistence, UI, or command-family migration.

## Agent-completeness guardrails

- Produce a path table for each handler with columns for legacy branch,
  application outcome, CLI rendering/exit mapping, mutation order, rollback,
  and exact test name. Every row must have evidence before old orchestration is
  removed; every in-scope legacy branch must appear exactly once.
- A passing end-to-end happy path is insufficient. Each external call must be
  asserted in order, and each failure test must assert which later calls did
  not occur and what durable state remains.
- Do not satisfy equivalence by replacing precise assertions with snapshots,
  normalizing output, swallowing stderr, accepting any nonzero exit, or mocking
  the application service itself in all handler tests.
- Do not retain old orchestration as fallback, catch-all recovery, or a
  feature-flagged alternate path. Rollback is a Git revert, not dual runtime
  behavior.
- Unit tests must mock every external dependency and must not call real Git,
  Forgejo, agents, network, nested `px`, nested test runners, or the full
  verifier. Only the declared top-level gates may run repository-wide checks.
- Stop for human direction if behavior characterization reveals an undocumented
  authority change, if exact compatibility conflicts with ADR 0051, if a new
  persistence/UI/security decision is needed, or if a fail-closed guard would
  need to be weakened.

## Rollback

Restore `lib/commands/stats-backfill.ts` and `lib/commands/active.ts` to the
pre-delegation wiring, then remove delegation-specific application modules.
Do not rewrite task records or Git-owned mission artifacts.

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Approval prerequisite is recorded and satisfied before work begins
- [ ] #2 Handler branch/path tables have no missing, duplicate, fallback, or untested row
- [ ] #3 Tests are fast, use strict mocks, and execute no real or recursively launched external workflow
- [ ] #4 Failure evidence includes call order, forbidden later calls, rollback/partial state, exact output channel, and exact exit code
- [ ] #5 Static guards prove there is one composition path and no shadow legacy orchestration in the two handlers
- [ ] #6 CLI compatibility evidence covers every named text, JSON, stderr, write, and exit-code case without weakened assertions
- [ ] #7 The final checkpoint cites the baseline metric command without claiming unmeasured improvement
- [ ] #8 Changed-line hygiene and required verification commands pass on the final tree
<!-- DOD:END -->

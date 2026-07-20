---
id: TASK-2278
title: Establish UI-neutral application architecture and ADR 0051
status: done
assignee: [codex]
created_date: '2026-07-19 00:00'
labels: [ai_sdlc]
dependencies:
  - TASK-2276
  - TASK-2277
references:
  - docs/adr/0044-workflow-distribution-model.md
  - docs/adr/index.md
  - lib/index.ts
  - lib/tools/backlog.ts
  - https://claude.ai/code/artifact/5f739bc8-6e14-48c7-aca6-ed9a96923432
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Research and decide ADR 0051 for the interface boundary shared by the headless
CLI, Ink TUI, and a future local web board. Treat the linked board artifact as
UI intent only: operator attention, workflow visibility, agent health, guarded
actions, flow signals, and execution feedback. Do not adopt its component
architecture, in-memory state, direct mutation path, or styling as product
architecture.

This is an ADR-and-planning mission. It defines UI-neutral commands, queries,
projections, progress, errors, cancellation, capabilities, ports, dependency
direction, retained authority, reliability measurement, and rollback. It does
not extract application code or delegate CLI handlers. The implementation is
partitioned into human-gated TASK-2289 and TASK-2290, with TASK-2291 owning the
first completed-mission reliability cohort.

Canonical task records remain under `backlog/tasks/`, `backlog/completed/`,
and `backlog/archive/`, with Git-owned mission and review artifacts retaining
their roles. A separate authority ADR is required before a board replaces those
records; `backlog.md` remains optional.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] #1 ADR 0051 defines and indexes dependency direction for domain policy, application commands/queries, ports, adapters, CLI, Ink TUI, and web transport
- [x] #2 ADR 0051 records repository-specific evidence and evaluates command handlers, UI facade/direct processes, narrow Hexagonal Architecture, Clean Architecture, authority migration, and generalized rewrite alternatives
- [x] #3 ADR 0051 defines command result, read projection, progress/event, typed error, cancellation, and capability/authorization contracts usable by each interface type
- [x] #4 ADR 0051 records the complete board intent while rejecting direct UI mutation and retaining the same validated lifecycle rules as the CLI
- [x] #5 Current task Markdown and Git-owned mission/review state remain authoritative; SQLite, web authority, and task-catalog migration require later decisions
- [x] #6 Reliability is the primary decision driver, measured only across completed missions: 39 bug-labelled and 90 non-bug completed missions in the 2026-06-22 through 2026-07-20 baseline
- [x] #7 TASK-2289 and TASK-2290 partition contracts/composition and CLI delegation with exact files, tests, NEL limits, rollback, negative guard fixtures, strict mocks, no-bypass checks, and explicit human approval
- [x] #8 TASK-2291 owns post-integration completed-mission cohort measurement without allowing open tasks, speed, malformed data, or cohort redefinition to dilute the bug ratio
- [x] #9 Downstream ordering requires TASK-2289 → TASK-2290 → TASK-2279 before ESM, SQLite, board, TUI, or web work can consume the new seam
- [x] #10 This mission changes documentation and backlog/mission planning only; application modules, CLI behavior, persisted authority, and production tests remain untouched
<!-- AC:END -->

## Implementation Plan

1. Inventory selected command behavior, authorities, failure semantics, and repository reliability evidence.
2. Evaluate the architecture alternatives and write/index ADR 0051 before implementation.
3. Define contracts, dependency direction, retained authority, reliability measurement, verification, and rollback in the ADR.
4. Create bounded, human-gated implementation missions with executable completeness and no-bypass guardrails.
5. Validate task IDs, references, dependency ordering, Markdown structure, and checkpoint evidence without modifying production code.

## Definition of Done

<!-- DOD:BEGIN -->
- [x] #1 ADR and planning evidence use current repository paths, task IDs, and exact existing test names
- [x] #2 Follow-up missions contain explicit scope, stop, NEL, rollback, strict-mock, failure-path, and no-placeholder guardrails
- [x] #3 No production code or test behavior changed, and no real Forgejo, agent, network, or expensive external workflow was invoked for this cleanup
- [x] #4 No TUI, web server, SQLite database, task-authority migration, application seam, or CLI delegation is implemented in this mission
<!-- DOD:END -->

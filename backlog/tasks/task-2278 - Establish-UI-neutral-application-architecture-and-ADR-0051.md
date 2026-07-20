---
id: TASK-2278
title: Establish UI-neutral application architecture and ADR 0051
status: review
assignee: [codex]
created_date: '2026-07-19 00:00'
labels:
  - architecture
  - refactor
  - adr
  - ui
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
Create ADR 0051 for the interface boundary shared by the headless CLI, Ink TUI, and a future local web board, then establish that boundary in code through one representative vertical slice. The ADR must treat the linked board artifact as UI intent only: operator attention, workflow visibility, agent health, guarded actions, flow signals, and execution feedback. It must not adopt the artifact's component architecture, in-memory state, direct state mutation, or styling as product architecture.

The refactor establishes UI-neutral commands, queries, projections, progress events, and ports. CLI output formatting, Ink rendering, HTTP transport, SQLite, Git, Forgejo, filesystem access, and subprocess execution remain outside domain and application policy. The existing CLI delegates through the new seam without changing supported behavior.

ADR 0051 must explicitly anticipate a web board that may eventually replace the current task-file/backlog presentation. It must preserve the current authority until a separate migration decision: canonical task records currently live under `backlog/tasks/`, `backlog/completed/`, and `backlog/archive/`; `backlog.md` itself is already optional.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 ADR 0051 defines dependency direction for domain, application commands/queries, ports, adapters, CLI, Ink TUI, and web transport, and is added to `docs/adr/index.md`
- [ ] #2 ADR 0051 defines one canonical command contract, read projection contract, progress/event contract, error contract, cancellation contract, and capability/authorization contract usable by all interfaces
- [ ] #3 ADR 0051 records the board UI intent: repository identity, attention queue, backlog/refined/active/review/integrate/shipped views, agent availability, WIP and cycle-flow signals, guarded lifecycle actions, and command/event log
- [ ] #4 ADR 0051 rejects direct UI mutation of workflow state; drag/drop and buttons may request application commands only, and invalid transitions fail through the same rules as the CLI
- [ ] #5 ADR 0051 keeps current task Markdown and Git-owned mission state authoritative and requires a separate authority ADR before a web board replaces those records
- [ ] #6 A representative read use case and one representative lifecycle command move behind UI-neutral application interfaces; existing CLI handlers delegate to them with unchanged text, JSON, and exit-code behavior
- [ ] #7 Import-boundary tests fail if domain/application code imports Ink, React, HTTP frameworks, SQLite, filesystem, Git, Forgejo, child-process, or terminal rendering modules outside declared ports
- [ ] #8 The composition root is the only place that wires complete concrete adapters; unit tests construct application services with mocks
- [ ] #9 `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` pass
- [ ] #10 Rollback restores the prior CLI wiring and removes the new architecture seam without changing persisted state
<!-- AC:END -->

## Implementation Plan

1. Inventory existing command handlers, state readers, output formatters, and effectful dependencies.
2. Write ADR 0051 before choosing framework-specific implementation details.
3. Introduce application request/result/progress types and declared ports.
4. Refactor one read and one mutation vertical slice; keep compatibility adapters for existing callers.
5. Add import-boundary and behavior-equivalence tests.

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 ADR and code evidence use current repository paths and exact tests
- [ ] #2 Static analysis and fast tests pass on the final tree
- [ ] #3 Unit tests mock all external dependencies and never contact real Forgejo or agents
- [ ] #4 No TUI, web server, SQLite database, or task-authority migration is implemented in this mission
<!-- DOD:END -->

---
id: TASK-2332
title: Post-2322 cleanup — Ports and adapters architecture
status: active
assignee: [qwen]
created_date: '2026-07-31 08:00'
updated_date: '2026-07-31 08:00'
labels:
  - architecture
  - cleanup
  - ai_sdlc
dependencies:
  - TASK-2322.12
references:
  - docs/adr/0051-ui-neutral-application-boundary.md
  - docs/adr/0053-operational-persistence-and-authority-boundaries.md
  - src/
  - test/application-boundaries.test.ts
parent_task_id: null
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parent architecture task for the post-2322 cleanup sequence. After ADR 0053 cutover is certified (TASK-2322.12), this sequence codifies the intended dependency graph, establishes a single composition boundary, moves contracts to their owning layer, re-owns active mission execution, consolidates inbound command surfaces, and removes all migration scaffolding.

This is an explicitly ports-and-adapters-focused cleanup. Each child mission is bounded, characterized, and burns down architectural debt from the prior migration wave. The sequence is intentionally sequential — missions modify the same seams, and parallelism would risk architectural drift.

**Dependency chain:** 2322.12 → .01 → .02 → .03 → .04 → .05 → .06

**Child missions:**

| Child | Title | Purpose |
|---|---|---|
| TASK-2332.01 | Codify the intended dependency graph | Executable import-boundary rules from ADR 0051 |
| TASK-2332.02 | Establish one production composition boundary | Single composition root, no cycles |
| TASK-2332.03 | Move contracts to their owning layer | Application ports organized by capability |
| TASK-2332.04 | Re-own active mission execution in application layer | Real use case replacing LegacyActiveAdapter |
| TASK-2332.05 | Consolidate inbound command surfaces | One dispatch path for CLI and TUI |
| TASK-2332.06 | Remove migration scaffold and certify architecture | Zero exceptions, docs match graph |

**Guardrails:**
- No mission may change behavior beyond what its acceptance criteria require.
- Characterization tests must prove behavioral equivalence before legacy code is deleted.
- Static analysis (`./scripts/verify-local.sh static-analysis`) must pass on every integration.
- No production code movement beyond what is required to install the guard for each mission.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All six child missions are integrated in order
- [ ] #2 TASK-2332.01 installs graph-based import validation with allowlist
- [ ] #3 TASK-2332.02 establishes single composition root with no adapter→composition imports
- [ ] #4 TASK-2332.03 moves application ports to capability-organized files
- [ ] #5 TASK-2332.04 replaces LegacyActiveAdapter with ExecuteMission use case
- [ ] #6 TASK-2332.05 produces one canonical command-dispatch path
- [ ] #7 TASK-2332.06 removes all migration scaffolding and certifies zero-exception dependency graph
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All child missions integrated with passing integration gates
- [ ] #2 Architecture documentation matches the executable dependency graph
- [ ] #3 No deferred migration TODO or compatibility façade remains
- [ ] #4 Full verification suite passes on final tree
<!-- DOD:END -->

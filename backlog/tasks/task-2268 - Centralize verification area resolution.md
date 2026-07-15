---
id: TASK-2268
title: Centralize verification area resolution across lifecycle gates
status: backlog
assignee: []
created_date: '2026-07-11 07:45'
updated_date: '2026-07-11 07:45'
labels: []
dependencies: []
references:
  - lib/core/verification.ts
  - lib/commands/integrate.ts
  - lib/review/review-commands.ts
  - lib/commands/checkpoint.ts
  - lib/commands/handoff.ts
priority: medium
ordinal: 7001
---

## Description

Centralize changed-file-to-area mapping and apply strict diff-scoped area
selection to reviewer verification, checkpoint, handoff, and integration
preflight. Preserve each phase's appropriate gate plan while eliminating the
legacy missing-mission `docs` fallback.

## Acceptance Criteria

- [ ] One shared area-mapping implementation handles known directories and workflow root files.
- [ ] Mixed-area changes select a strict superset rather than an arbitrary area.
- [ ] Reviewer verify, checkpoint, handoff, and integration preflight do not weaken verification when a mission document is missing.

## Codex Pre-Draft

**Goal:** define one authoritative changed-file-to-area resolver and make every lifecycle phase choose the strictest applicable verification plan from it.

**Scope and proof:** inventory existing area mappings and missing-mission fallbacks across reviewer verification, checkpoint, handoff, and integration; extract a shared resolver with explicit root-file and mixed-area rules; migrate each call site; add table-driven tests showing identical mapping and strict-superset selection at every phase.

**Checkpoints:** (1) mapping/fallback inventory and red divergence tests; (2) shared resolver plus call-site migration; (3) mixed-area and missing-mission lifecycle regressions with integration-gate evidence.

**Stop rule:** do not replace an unknown/missing mission area with `docs` or any weaker default; unresolved scope must select the conservative general/strict plan or fail with a clear diagnostic.

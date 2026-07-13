---
id: TASK-2218
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

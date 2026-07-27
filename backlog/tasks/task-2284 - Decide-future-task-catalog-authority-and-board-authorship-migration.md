---
id: TASK-2284
title: Decide future task catalog authority and board authorship migration
status: active
assignee: [claude]
created_date: '2026-07-19 00:00'
updated_date: '2026-07-24 04:32'
labels:
  - architecture
  - adr
  - backlog
  - migration
  - user_value
dependencies:
  - TASK-2307
references:
  - docs/adr/0044-workflow-distribution-model.md
  - docs/adr/0051-ui-neutral-application-boundary.md
  - lib/tools/backlog.ts
  - backlog/config.yml
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decide whether canonical task authority should remain Git-tracked Markdown, move to SQLite, or use another portable model, and whether an operator board should become the primary task-authoring surface. Create a dedicated task-authority ADR; do not hide this decision inside UI implementation.

TRIGGER: this decision needs one operator board that has proven a real read AND command experience over the shared contracts — not a specific client. The Ink TUI wave sequence supplies that: TASK-2306 proves the attention/read experience and TASK-2307 proves guarded command dispatch. This mission therefore depends on TASK-2307, NOT on the web board (TASK-2283), which is unprioritized. Gating the ADR 0044 authority cutover behind an unbuilt UI would block the persistence decision indefinitely; the authoring-surface question can be answered from the TUI and extended to any later client.

Current reality must anchor the decision: `backlog.md` is optional, while canonical records are individual files in `backlog/tasks/`, `backlog/completed/`, and `backlog/archive/`. A board may replace the presentation before it replaces the authority.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A new ADR inventories current task creation, ID allocation, status transitions, main-branch writes, archival, Git review, portability, and recovery behavior
- [ ] #2 The ADR compares at least Git Markdown authority, SQLite authority with export, and append-only event authority with materialized views
- [ ] #3 The decision defines offline behavior, multi-repository identity, concurrent writers, merge/conflict handling, backup, corruption recovery, downgrade, import/export, human inspection, and automation access
- [ ] #4 Dual-write is rejected as a steady state; any temporary compatibility write has reconciliation rules, telemetry, a removal gate, and a bounded lifetime
- [ ] #5 Any board client can author and edit tasks only through the selected application port and capability rules, never direct SQL or filesystem writes; the rule is stated client-neutrally so it binds the TUI and any future web board equally
- [ ] #6 Existing repositories remain portable and operable from CLI throughout migration
- [ ] #7 A dry-run importer/exporter round trip proves no loss of frontmatter, description, acceptance criteria, dependencies, references, priority, or unknown extension fields
- [ ] #8 The ADR states whether task content remains version-controlled and reviewable, and why
- [ ] #9 Implementation follow-up tasks are created only after the authority decision, with compatibility and rollback gates
- [ ] #10 This mission does not delete or silently demote current task files
<!-- AC:END -->



## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Inventory all task readers, writers, transitions, and Git behaviors.
2. Evaluate authority alternatives against portability and board requirements.
3. Prototype a lossless round trip without changing authority.
4. Record the decision in a dedicated ADR and create implementation missions.
<!-- SECTION:PLAN:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 ADR evidence cites exact repository behavior and tests
- [ ] #2 Documentation verification passes
- [ ] #3 No production authority or stored task is changed
- [ ] #4 Follow-up scope and rollback are explicit
<!-- DOD:END -->

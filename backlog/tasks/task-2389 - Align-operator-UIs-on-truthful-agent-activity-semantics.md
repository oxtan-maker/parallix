---
id: TASK-2389
title: Align operator UIs on truthful agent activity semantics
status: review
assignee: [codex]
created_date: '2026-08-21 11:04'
labels:
  - user_value
  - architecture
dependencies:
  - TASK-2387
  - TASK-2388
references:
  - src/application/projections/mission-board.ts
  - src/application/projections/agent-status.ts
  - src/interfaces/tui/agent-strip.tsx
  - src/application/ports/cli-workflows.ts
  - src/interfaces/cli/status.ts
priority: medium
ordinal: 106917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The TUI currently presents two different concepts as running agents: authoritative mission currentWork and recovery evidence from live px coordinator commands. The agent strip labels coordinator counts as N running even though agents launched inside px ui are absent and a coordinator may remain alive during non-agent phases. px status discards both activity facts. Define one interface-neutral activity read contract and make every operator surface describe only what its evidence proves. Do not introduce a durable Attempt aggregate unless exact concurrent per-launch identity becomes an explicit requirement.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The shared projection distinguishes authoritative operation work from recovery-only coordinator-process evidence and preserves live, unknown, stale, and stopped semantics without UI inference.
- [ ] #2 The agent strip no longer labels active px coordinators as exact running-agent counts; either show evidence-qualified active command or mission wording, or derive exact counts from a real launcher lifecycle source.
- [ ] #3 px status exposes the same mission activity and uncertainty state as the TUI for a selected mission.
- [ ] #4 Overlapping operations and unattributed families have explicit projection behavior and do not silently overwrite a count claimed to represent agents.
- [ ] #5 Focused rendering tests prove the TUI and status CLI agree for live, recovery-only, unknown, stale, blocked, and idle cases.
- [ ] #6 ./scripts/verify-local.sh static-analysis passes; docs verification also passes if user-facing terminology changes.
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

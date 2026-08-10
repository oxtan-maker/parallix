---
id: TASK-2350
title: Reconcile interrupted handoffs before review-loop writes
status: done
assignee: [codex]
created_date: '2026-08-09 13:00'
labels:
  - ai_sdlc
  - bug
dependencies: []
references:
  - 'src/adapters/cli/commands/handoff.ts:752-790'
  - 'src/adapters/review/review-state.ts:548-573'
  - 'src/adapters/review/review-loop.ts'
ordinal: 83910
---

## Description

An interrupted or pre-cutover handoff can leave the Backlog task in `review` while the authoritative SQLite Mission has no `Review` aggregate. A subsequent `px review` then starts its loop and immediately tries to persist round-one state. `ReviewState.save()` correctly fails closed because no aggregate exists, producing: "has no review to update; px handoff starts the review".

This was observed for TASK-2347.04 on 2026-08-09. The mission's changes are confined to metrics and TUI code, so it did not introduce the fault. The inconsistent state was caused by workflow evolution/interruption: the current handoff flow creates the aggregate before moving Backlog, but existing stranded records remain unreconciled and the review command has no safe recovery path.

Provide an explicit, idempotent reconciliation path for a task already in Backlog `review` with a missing Mission review aggregate. It must reconstruct the aggregate only from the canonical handoff inputs (branch, target, reviewer/implementer identity, revision and eligibility), never invent one from loop state. Make `px review` direct the operator to that path before launching a reviewer, or safely invoke it when the required inputs are fully available. Preserve the fail-closed behavior for genuinely malformed or ambiguous missions.

## Acceptance Criteria

- [ ] #1 A hermetic reproduction seeds a Mission without `review`, marks its Backlog task `review`, and proves the current review-loop persistence failure
- [ ] #2 The supported reconciliation command/path creates a valid round-one Review aggregate idempotently without changing the mission payload or moving Backlog out of `review`
- [ ] #3 After reconciliation, `px status <slug>` reports a started review and `px review <slug>` reaches reviewer launch rather than the missing-review persistence error
- [ ] #4 Ambiguous identity, missing Mission, or malformed legacy state remains a clear fail-closed error with actionable guidance
- [ ] #5 Focused tests mock Forgejo and agents; no unit test launches real CLIs or contacts Forgejo

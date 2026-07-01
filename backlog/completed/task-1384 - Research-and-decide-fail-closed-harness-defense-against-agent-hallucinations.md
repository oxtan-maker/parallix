---
id: TASK-1384
title: Research and decide fail-closed harness defense against agent hallucinations
status: done
assignee:
  - claude
created_date: '2026-06-28 11:30'
updated_date: '2026-07-01 19:24'
labels:
  - harness
  - reliability
  - research
  - architecture
  - ai_sdlc
dependencies: []
references:
  - docs/adr/0041-integration-pipeline-gates.md
  - >-
    backlog/completed/task-1335 -
    Harden-parallix-self-hosting-publish-path-so-broken-trees-cannot-reach-main.md
  - backlog/tasks/task-1268 - Shift-left.md
  - lib/commands/handoff.js
  - lib/commands/repair-handoff.js
  - docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parallix already has meaningful defenses against agent hallucinations and incomplete work, but they are fragmented across several missions and commands. The repo has exact-tree verification proof, handoff pre-checks, gatekeeper mandatory-artifact checks, integration-time gates, and a narrow `repair-handoff.js` auto-repair path. It also has open work on shift-left verification (TASK-1268).

What it does not yet have is one explicit answer to a repository-level question:

**How should Parallix defend the codebase against agent hallucinations and incomplete tasks by catching them mechanically and sending them back to the implementer automatically when possible?**

This task produced ADR 0048, which:

1. Inventories 23 existing check points across 5 lifecycle phases (before handoff, during handoff, before review, during integration, repair path)
2. Classifies 8 failure classes as auto-repair, auto-send-back, or human-only
3. Evaluates 7 candidate harness controls in a decision matrix
4. Recommends implementation order: C3 (error classifier) → C2 (gate-failure send-back) → C1 (pre-review gate) → C4 → C5 → C6 → C7
5. Defines which classes should auto-repair (mechanical git issues, malformed gates), auto-send-back (gate failures, missing artifacts, incomplete evidence), or require human intervention (infra blockers, state violations)

The backlog child tasks (TASK-1385 through TASK-1389, TASK-1392, and TASK-1393) implement the full recommended control set from the ADR. Nothing in the ADR is left as an untracked deferred idea.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A new ADR under `docs/adr/` defines the fail-closed harness posture against agent hallucinations, including current checks, missing checks, and send-back policy
- [ ] #2 The ADR classifies at least 5 candidate checks or failure classes as auto-repair / auto-send-back / human-only and justifies each choice against this repo's harness design
- [ ] #3 The parent task and child backlog tasks are updated so the backlog matches the ADR's full implementation plan, and all child task slugs use integer task IDs only
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

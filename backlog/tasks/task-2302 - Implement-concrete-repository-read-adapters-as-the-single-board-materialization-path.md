---
id: TASK-2302
title: >-
  Implement concrete repository read-adapters as the single board
  materialization path
status: refined
assignee: [custom]
created_date: '2026-07-23 00:00'
labels:
  - application
  - board
  - architecture
  - adapters
  - user_value
dependencies:
  - TASK-2281
references:
  - docs/adr/0044-workflow-distribution-model.md
  - docs/adr/0051-ui-neutral-application-boundary.md
  - src/application/projections/board-readers.ts
  - src/adapters/backlog/mission-materialization.ts
  - src/platform/runtime/lib/tools/backlog.ts
  - src/platform/runtime/lib/review/review-state.ts
  - src/platform/runtime/lib/commands/status.ts
  - src/platform/runtime/lib/core/mission-utils/paths.ts
priority: high
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2281 built the board read-model, guarded controller, metrics, and the read-adapter PORT INTERFACES (`MissionReadAdapter`, `ReviewReadAdapter`, `GateReadAdapter`, `AgentReadAdapter`, `GitReadAdapter`, `OperationLogReadAdapter` in `src/application/projections/board-readers.ts`) plus a `BoardProjectionBuilder` that composes them. It ships NO concrete implementations: every test injects a fake. TASK-2294 delivered only pure code — domain types plus `materializeBacklogMission()` in `src/adapters/backlog/mission-materialization.ts`, which reconciles an ALREADY-PARSED `BacklogMissionRecord` into a domain `Mission` and never touches `node:fs` or git. TASK-2295 implemented SQLite for operator-local state only (blocklist, usage, known repositories, UI prefs, local history, migration metadata) and, by ADR 0044/0051 design, does NOT materialize missions/reviews/gates.

The result is a hole in the middle of the chain: nothing goes from the live authorities (`backlog/tasks|completed|archive/*.md`, mission worktrees, `.workflow`/review-state, gate results, agent config) into the domain `Mission`/`Review`/gate/agent-availability objects the pure projection consumes. This mission fills that hole by implementing the CONCRETE read adapters, and it is a dependency of TASK-2282 (Ink TUI), which would otherwise absorb this scope and re-run the TASK-2280 cascade.

SINGLE CODE PATH IS THE POINT. Parallix already has a second, ad-hoc board-shaped assembly: the legacy `status` command glues `getTaskStatus`, `findCheckpoints`, `getPrStatus`, and `findStaleMissionWorktrees` together to render mission state (`src/platform/runtime/lib/commands/status.ts:107-219`). If this mission adds concrete adapters WITHOUT retiring that duplicate, the repository is left with two divergent ways to answer "what is the state of this mission?" — exactly the kind of duplicate path agents hallucinate against endlessly. Therefore the concrete adapters delivered here MUST become the ONE materialization path for board/mission projection, and the legacy `status` projection MUST be re-implemented over these adapters (or deleted) in the same mission — not left as a parallel reader.

SCOPE THE RETIREMENT HONESTLY (avoid the 2280 cascade). The low-level file/git primitives — `resolveTaskFile`, `getTaskStatus`, `getTaskAssignee`, `getTaskFrontmatterValue` (`src/platform/runtime/lib/tools/backlog.ts:994-1018`), `readReviewState` (`src/platform/runtime/lib/review/review-state.ts:94`), `findMissionDir`/`findCheckpoints` (`src/platform/runtime/lib/core/mission-utils/paths.ts:132,220`) — are the parsing primitives the new adapters USE; they are NOT the duplicate and are NOT retired here. What is retired is any code that ASSEMBLES a competing mission/board projection outside the adapter. Concretely: exactly one function produces a domain `Mission` (reusing `materializeBacklogMission`), exactly one produces a domain `Review`, and the board/status surfaces read only those. Do not convert the ~15 command consumers of `getTaskStatus` to async or route them through the domain model — that is off-plan.

NO NEW DB MODELLING FOR MISSIONS/REVIEWS/GATES — BY DESIGN. Mission, review, and gate state are Git/Markdown repository-authority; persisting them in SQLite would violate the ADR 0044/0051 authority map ("repository state wins, no dual-write"). This mission therefore adds no mission/review/gate tables. The only operator-local durable state the board metrics need is the lane-transition/operation event history, and TASK-2295 already created a generic `operational_history` table + `append()` API (`src/adapters/sqlite/operational-history-repository.ts`, migration `0001-initial-schema.sql:73`). This mission READS that table through the TASK-2295 snapshot and reports explicit missing-history per TASK-2281 AC#3; it does NOT add a typed board-event schema and does NOT emit events. The typed lifecycle/lane-transition event schema plus the recording WRITE path (emitting an event when a mission changes lane) is a distinct write-side concern and is a NON-GOAL here — recorded as follow-up TASK-2303 so metrics move from "missing history" to populated without reopening this read mission.

Authority stays per ADR 0044/0051: repository state wins; SQLite/board caches are stale fallback, never mutation authority. This mission adds READ adapters only — no new write path, no lifecycle transition, no mutation use case beyond what TASK-2281/2290 already integrated.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Concrete `MissionReadAdapter` reads `backlog/tasks|completed|archive/*.md` frontmatter (via the existing parse primitives) and mission worktree/checkpoint content, reconciles integration-base vs worktree per the ADR 0051 materialization contract using `materializeBacklogMission`, and returns domain `Mission` objects with source facts for rebuildability
- [ ] #2 Concrete `ReviewReadAdapter` and `GateReadAdapter` materialize domain `Review` rounds/approval and latest gate status from the Git-owned review-state and gate results, returning typed unavailable/missing results rather than inventing a lifecycle state
- [ ] #3 Concrete `AgentReadAdapter` (availability, timed-block countdown) and `OperationLogReadAdapter` read from the TASK-2295 operator-local snapshot, not by re-reading files ad hoc
- [ ] #4 Concrete `GitReadAdapter` supplies repository identity and HEAD for staleness checking; the composition root wires the full `BoardProjectionBuilder` over these concrete adapters
- [ ] #5 SINGLE PATH: exactly one function materializes a domain `Mission` and exactly one materializes a domain `Review`; a guardrail test fails if any other module assembles a mission/board/status projection outside these adapters
- [ ] #6 RETIREMENT: the legacy `status` command's ad-hoc board assembly (`status.ts` gluing `getTaskStatus`/`findCheckpoints`/`getPrStatus`/`findStaleMissionWorktrees`) is re-implemented over the new projection or removed, so no second board-shaped reader remains; its existing behavior/output contract is preserved by test
- [ ] #7 The low-level parse primitives (`resolveTaskFile`, `getTaskStatus`, `getTaskAssignee`, `getTaskFrontmatterValue`, `readReviewState`, `findMissionDir`, `findCheckpoints`) remain synchronous and are NOT removed, NOT made async, and their non-board command consumers are unchanged
- [ ] #8 Repository state wins: a test proves the concrete adapters prefer committed integration-base/Git state over any SQLite or board cache, and a cache never becomes mutation authority
- [ ] #9 Projections are rebuildable from scratch and the adapters run with real fixtures (temp repo/worktree) without launching agents, contacting Forgejo, or running expensive external CLIs
- [ ] #10 Unit/integration tests cover each concrete adapter, the integration-base-vs-worktree reconciliation, missing/unavailable sources, and the single-path guardrail
- [ ] #11 `./scripts/verify-local.sh all` passes plus `./scripts/verify-local.sh static-analysis` for the changed `src/` code
<!-- AC:END -->

## Implementation Plan

1. Implement the concrete `MissionReadAdapter` over the existing parse primitives + `materializeBacklogMission`, establishing the single mission-materialization function.
2. Implement concrete `ReviewReadAdapter`/`GateReadAdapter` over review-state and gate results; `AgentReadAdapter`/`OperationLogReadAdapter` over the TASK-2295 snapshot; `GitReadAdapter` over Git.
3. Wire `BoardProjectionBuilder` in the composition root over the concrete adapters.
4. Re-point (or delete) the legacy `status` board assembly onto the projection; preserve its output contract with a characterization test.
5. Add the single-path guardrail test and prove repository-wins reconciliation.

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Exactly one board/mission materialization path exists after this mission; the guardrail test enforces it and the legacy duplicate is gone
- [ ] #6 No new write path, lifecycle transition, or async cascade into legacy command consumers was introduced
<!-- DOD:END -->

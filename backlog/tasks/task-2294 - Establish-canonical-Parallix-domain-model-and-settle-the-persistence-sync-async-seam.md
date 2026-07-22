---
id: TASK-2294
title: >-
  Establish canonical Parallix domain model and settle the persistence
  sync/async seam
status: backlog
assignee: []
created_date: '2026-07-22 04:47'
labels:
  - domain-model
  - architecture
  - adr
  - persistence
dependencies: []
references:
  - docs/adr/0044-workflow-distribution-model.md
  - docs/adr/0051-ui-neutral-application-boundary.md
  - docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md
  - >-
    backlog/tasks/task-2280 -
    Add-bounded-SQLite-operator-state-and-migrations.md
  - src/platform/runtime/lib/core/storage.ts
  - src/platform/runtime/lib/core/durable-state-inventory.ts
  - src/platform/runtime/lib/core/state-map.ts
  - src/platform/runtime/lib/agents/agent-config.ts
  - src/platform/runtime/lib/agents/launcher-selection.ts
priority: high
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parallix has no canonical domain model. Each feature re-derives an ad hoc slice of workflow state, so every persistence or interface change ripples across the codebase. TASK-2280 (bounded SQLite operator state) dead-ended at MAX_ATTEMPTS after 5 review rounds: a bounded adapter grew to ~4,525 insertions across 48 files because making one operator-local read async (per the ADR 0044 async-port contract) cascaded `await` through the synchronous agent-eligibility/selection/review consumers that were never modeled as owning that state.

This mission makes an honest attempt at a domain model that will NOT need heavy refactoring as Parallix travels toward its UI direction (the operator board / Ink TUI / local web client). It is a MODELING mission, not an implementation one: it delivers the pure domain model as checked code plus a thin, code-proven decision on where the sync/async seam sits — and deliberately ships no SQLite adapter, no migration, and no repository-authority change.

WHY code + amended ADRs (not a new ADR): a domain model is a living structure reviewed as checked types, not an immutable decision record. The model itself lives in `src/domain/` (types + invariant tests) with a living design note; only the one genuinely-decisional part — the sync/async seam that caused the 2280 cascade — is written up, and it is compacted into the ADRs that already own the concern (0044 authority classes / SQLite ports; 0051 hexagonal boundary), in place, stating the current active decision. No new ADR; no appended history or superseded clauses.

CODE LEADS, ADR IS WRITTEN LAST. The seam decision must be derived from building the model against the real consumer that cascaded, not mandated ahead of it (mandating-ahead is exactly how 0044 produced the 2280 failure). Prove the seam on ONE consumer path — agent eligibility/selection — using a materialized in-memory snapshot loaded at the composition root: async only at the port, synchronous reads in the hot algorithm. Establish the pattern; do not rewire all 48 consumers.

FUTURE STATE IS IN SCOPE. The entity model, the entity-level authority map, and the read-model/access-pattern catalog must be explicitly validated against the future UI read surfaces the board artifact specifies (mission-list projection with class/state/agent/checkpoint/gate/next-action/PR/blocking/flags; attention ranking inputs; cumulative-flow and median-cycle-time time series; WIP; agent availability with timed-block countdown; command/event log) AND against the deferred task-authority seam (mission lifecycle may later move from Markdown/Git into another store). The model must let those later UI-ward missions land as projection/adapter additions, not as a model rewrite. It must NOT decide the task-authority question here (that remains a separate ADR per 0051); it must only keep the seam swappable.

Boundaries and disposition: canonical mission lifecycle stays in Markdown/Git and operator-local state stays under PARALLIX_HOME per ADR 0044/0051 — "repository state wins", no dual-write. The dead-ended `mission/task-2280` branch is kept UNMERGED as a reference spike; a separate follow-up re-homes the SQLite work to conform to this model.

Key context: current state surfaces are `src/platform/runtime/lib/core/storage.ts` (PARALLIX_HOME resolution, stats.csv, agents.local.json), `.../core/durable-state-inventory.ts` (path-based MACHINE_WRITTEN_PATH_INVENTORY, to be superseded by an entity-level authority map), `.../core/state-map.ts` (config/state-map.json lifecycle states), `.../review/review-state.ts`, `.../agents/agent-config.ts` + `agents.ts` + `launcher-selection.ts` (the sync consumers that cascaded), `.../commands/stats.ts` (usage schema). Board read-model spec: docs/adr/0051 "Authority and board intent" section. `src/domain/` currently contains only a README.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Canonical domain model exists as pure code under `src/domain/` (TypeScript types/value objects) importing no React, Ink, SQLite, node:fs, git, subprocess, Forgejo, or terminal module, enforced by the import-boundary test
- [ ] #2 The model covers, with explicit identity and invariants, at least: Mission, Checkpoint, Review, Finding, AgentFamily/eligibility, UsageRecord, Repository, NelRecord, and SessionMarker; invariants are covered by unit tests
- [ ] #3 An entity-level authority map assigns each entity/field exactly one authority owner (Git-Markdown target-repo state vs operator-local/PARALLIX_HOME vs tool-owned asset), marks cache-vs-source-of-truth, encodes 'repository state wins', and supersedes the path-based MACHINE_WRITTEN_PATH_INVENTORY intent
- [ ] #4 A read-model / access-pattern catalog enumerates the queries the CLI, board, and TUI need and is explicitly validated against the board read surfaces (mission-list projection with class/state/agent/checkpoint/gate/next-action/PR/blocking/flags, attention-ranking inputs, cumulative-flow and median-cycle-time series, WIP counts, agent availability with timed-block countdown, command/event log)
- [ ] #5 The mission-lifecycle state machine (states, transitions, guards, triggerers) is modeled in the domain, formalizing fail-closed handling (ADR 0048) and the launch->record->rollback ordering (ADR 0051), with tests asserting illegal transitions are rejected
- [ ] #6 The sync/async persistence seam is proven in code on the agent eligibility/selection consumer path via a materialized in-memory snapshot loaded at the composition root: async only at the port boundary, synchronous reads in the hot algorithm, with a test proving no async cascade is required in that consumer
- [ ] #7 The model and its seams are validated to keep the deferred task-authority migration (mission lifecycle store) a swappable adapter concern without a model rewrite, without deciding that migration here
- [ ] #8 ADR 0044 and ADR 0051 are amended IN PLACE to state the current active sync/async seam decision as validated by the code proof; no new ADR is created and no superseded/history/dated-update prose is added (git holds history)
- [ ] #9 A living design note (e.g. `src/domain/README.md` or `docs/domain-model.md`), explicitly non-ADR and allowed to evolve, documents the model narrative, authority map, and read-model catalog and points at the checked code as the source of truth
- [ ] #10 The mission adds no SQLite adapter, no migration, and no change to repository/task authority or write paths; the `mission/task-2280` branch is left unmerged and a follow-up for the conforming SQLite implementation is recorded
- [ ] #11 `./scripts/verify-local.sh all` passes and, for the `src/` changes, `./scripts/verify-local.sh static-analysis` passes
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

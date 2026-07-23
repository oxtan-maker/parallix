# Mission: Establish canonical Parallix domain model and settle the persistence sync/async seam (task-2294)

## Goal

Deliver a pure TypeScript domain model under `src/domain/` and a code-proven sync/async persistence seam decision that stops the cascade pattern that dead-ended TASK-2280 at 5 review rounds and ~4,525 insertions across 48 files. The model accounts for every current Parallix state surface, assigns authority per concern, catalogs read-model queries against the board's future UI surfaces, and amends ADR 0044 and ADR 0051 in place — without shipping a SQLite adapter, migration, or authority change.

## Why Now

TASK-2280 (bounded SQLite operator state) dead-ended after 5 review rounds because making one operator-local read async (per ADR 0044's async-port contract) cascaded `await` through synchronous agent-eligibility/selection/review consumers that were never modeled as owning that state. The root cause is the absence of a canonical domain model: each feature re-derives an ad hoc slice of workflow state, so every persistence or interface change ripples across the codebase. This modeling mission is the prerequisite that lets TASK-2295 re-home the SQLite work as a conforming follow-up. It is also required before any UI-ward mission (Ink TUI, local web board) can land as projection/adapter additions rather than model rewrites.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium
- Selection note: activate as-is; expect senior review iteration on the model shape
- Main drivers: TASK-2280 cascade (48 files, 5 review rounds), no canonical domain model, board read surfaces need a projection-ready model, ADR 0044 async-port mandate needs a seam decision derived from evidence not mandate

## Scope

- Pure TypeScript domain model under `src/domain/` (types, value objects, entities, invariants) importing no React, Ink, SQLite, `node:fs`, Git, subprocess, Forgejo, or terminal module — enforced by an import-boundary test.
- Domain model covering all current Parallix state surfaces: mission lifecycle, checkpoints, review rounds and findings, agent families and eligibility, usage/statistics, known repositories, NEL capture, and session/resume markers. Each concern classified as entity, aggregate, value object, or attribute with justification.
- Entity-level authority map assigning each modeled concern/field exactly one authority owner (Git-Markdown target-repo state vs operator-local/PARALLIX_HOME vs tool-owned asset), marking cache-vs-source-of-truth, encoding "repository state wins", superseding the path-based `MACHINE_WRITTEN_PATH_INVENTORY` in `src/platform/runtime/lib/core/durable-state-inventory.ts`.
- Read-model / access-pattern catalog enumerating CLI, board, and TUI queries, explicitly validated against board read surfaces: mission-list projection (class/state/agent/checkpoint/gate/next-action/PR/blocking/flags), attention-ranking inputs, cumulative-flow and median-cycle-time series, WIP counts, agent availability with timed-block countdown, command/event log.
- Mission-lifecycle state machine modeled in the domain (states, transitions, guards, triggerers), formalizing fail-closed handling (ADR 0048) and launch→record→rollback ordering (ADR 0051), with tests asserting illegal transitions are rejected.
- Sync/async persistence seam proven in code on the agent eligibility/selection consumer path: materialized in-memory snapshot loaded at the composition root; async only at the port boundary; synchronous reads in the hot algorithm; test proving no async cascade is required.
- Task-authority seam validation: model and seams keep the deferred task-authority migration (mission lifecycle store) a swappable adapter concern without a model rewrite, without deciding that migration here.
- ADR 0044 and ADR 0051 amended IN PLACE for the validated sync/async seam decision; any other ADR the model work shows to misstate current reality (e.g. ADR 0048, ADR 0051 beyond the seam) MAY be compacted/corrected in place with cited evidence — current-active-decision only, no new ADR, no superseded/history prose.
- Living design note (e.g. `src/domain/README.md`) documenting model narrative, authority map, read-model catalog, and pointing at checked code as source of truth.
- Guardrails: traceability (every modeled concern traces to file:line), no ceremony (no entity/port/VO without a present consumer), credibility audit (modeling-decisions audit in design note), tests bite (invariant tests fail if rule is removed).

## Out of Scope

- SQLite adapter implementation, migration, or schema changes (delegated to TASK-2295).
- Changes to repository/task authority or write paths.
- Rewiring all 48 consumers that cascaded in TASK-2280 — only the agent eligibility/selection consumer path is proven.
- New ADRs (amendments only, in place).
- The task-authority migration decision itself (remains deferred per ADR 0051).
- Ink TUI, web board, or any interface implementation.
- The `mission/task-2280` branch (kept unmerged as a reference spike).

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `src/domain/` contains TypeScript type/value-object files with zero imports of `react`, `ink`, `node:sqlite`, `node:fs`, `node:child_process`, `node:os`, `node:path`, or any Git/Forgejo/terminal module, verified by an import-boundary test that fails on violation.
- SC2: The model defines types for all 8 current state surfaces (mission lifecycle, checkpoints, review rounds/findings, agent families/eligibility, usage/statistics, known repositories, NEL capture, session/resume markers), each classified as entity, aggregate, value object, or attribute with a cited current-state surface (file:line) justifying the classification.
- SC3: An entity-level authority map exists as checked code (not prose) assigning each modeled concern/field exactly one authority owner from the set {Git-Markdown target-repo, operator-local/PARALLIX_HOME, tool-owned asset}, marking cache-vs-source-of-truth, and superseding `MACHINE_WRITTEN_PATH_INVENTORY` (all 9 entries mapped).
- SC4: A read-model/access-pattern catalog enumerates at least 8 queries (mission-list projection with class/state/agent/checkpoint/gate/next-action/PR/blocking/flags, attention-ranking inputs, cumulative-flow time series, median-cycle-time series, WIP counts, agent availability with timed-block countdown, command/event log) and each is validated against a board read surface from ADR 0051 "Authority and board intent" section.
- SC5: The mission-lifecycle state machine models all states and transitions defined in `config/state-map.json` and `lib/commands/` lifecycle commands, formalizes ADR 0048 fail-closed handling, and includes tests that assert illegal transitions are rejected (at least 3 illegal transitions tested).
- SC6: A materialized in-memory snapshot pattern is implemented for the agent eligibility/selection consumer path (`src/platform/runtime/lib/agents/launcher-selection.ts`), with async loading at the port boundary and synchronous reads in `eligibleAgentsForStep`/`selectAgent`/`workflowLauncherStatus`, and a test proving no `await` cascades into the hot selection algorithm.
- SC7: The model and authority map contain no decision about task-authority migration; the deferred migration is represented as a swappable adapter seam (port interface) that the model depends on but does not implement.
- SC8: ADR 0044 is amended in place with the sync/async seam decision; ADR 0051 is amended in place with the seam decision; any additional ADR amended has cited evidence from the model work; no new ADR is created; no superseded/history/dated-update prose is added.
- SC9: A living design note (`src/domain/README.md` or `docs/domain-model.md`) exists with model narrative, authority map, read-model catalog, and a modeling-decisions audit (chosen shape, rejected alternative, concrete evidence for each non-obvious choice).
- SC10: The mission adds zero SQLite adapter files, zero migration files, and zero changes to repository/task authority write paths; `git diff` shows no new files under `src/adapters/sqlite/` or `assets/migrations/`.
- SC11: Every modeled concern has a cited file:line trace to a real current-state surface; no field or entity is modeled without a present consumer (current read/write or board-catalogued query); any intentionally deferred concern is listed in the design note with its trigger condition.
- SC12: No entity, port, value object, or abstraction is introduced without a present consumer; per ADR 0051 "do not manufacture a domain wrapper around every helper."
- SC13: Every invariant and seam test is behavioral — removing the tested rule causes the test to fail (no type-only or tautological assertions); every file:line and test name cited in the design note and final summary resolves to a real line/test.
- SC14: `./scripts/verify-local.sh all` passes on the final tree.
- SC15: `./scripts/verify-local.sh static-analysis` passes on the final tree for all `src/` changes.

## Risks and Assumptions

- **Risk: Model scope creep.** The domain model could grow beyond current-state surfaces into speculative future entities. Mitigation: traceability guardrail (SC11) requires every concern to cite a real current-state surface (file:line) or board-catalogued query.
- **Risk: ADR amendments introduce conflicts.** Amending ADR 0044 and ADR 0051 in place could conflict with other active missions. Mitigation: compact current-active-decision only; git history preserves prior text; coordinate with any mission amending the same ADRs.
- **Risk: The sync/async seam decision proves wrong for other consumer paths.** The model proves the seam on one path (agent eligibility/selection) — other paths may need different patterns. Mitigation: the design note records the proven pattern as the default and flags any consumer that deviates; TASK-2295 validates the pattern against the SQLite adapter.
- **Risk: Senior review requires substantial model iteration.** The mission explicitly expects back-and-forth. Mitigation: the credibility audit (SC13) and modeling-decisions audit give reviewers the reasoning to iterate efficiently, not just the output to judge.
- **Assumption: `src/domain/` is the correct location.** ADR 0044 specifies `src/domain/` as the domain layer; the current `src/domain/README.md` is a placeholder. This assumption is aligned with the target architecture.
- **Assumption: The 8 state surfaces enumerated in AC#2 are complete.** If the model work discovers additional current-state surfaces, they are added to the model with the same traceability guardrail.
- **Assumption: ADR 0044 and ADR 0051 are the only ADRs requiring amendment for the seam decision.** The mission MAY amend other ADRs (0048, 0051 beyond the seam) if the model work shows they misstate current reality — but this is conditional on evidence, not a requirement.

## Checkpoints

- CP 1: Domain model types and value objects. Create `src/domain/` structure with pure TypeScript types for all 8 state surfaces (mission lifecycle, checkpoints, review rounds/findings, agent families/eligibility, usage/statistics, known repositories, NEL capture, session/resume markers). Each classified as entity, aggregate, value object, or attribute with file:line trace. Import-boundary test added and passing. Unit tests for invariant rules.
- CP 2: Authority map and read-model catalog. Entity-level authority map as checked code (superseding `MACHINE_WRITTEN_PATH_INVENTORY`). Read-model/access-pattern catalog with queries validated against board read surfaces from ADR 0051. Mission-lifecycle state machine with illegal-transition tests.
- CP 3: Sync/async seam proof and ADR amendments. Materialized in-memory snapshot for agent eligibility/selection consumer path. Test proving no async cascade. ADR 0044 and ADR 0051 amended in place. Living design note with modeling-decisions audit. Task-authority seam validation. Final verification gates.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section with a 3-column pipe-delimited markdown table:

| Criterion | Evidence | Status |
|---|---|---|

- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/domain/mission.ts:42` (must point to an existing file and line)
  2. **Test names** — e.g., `"illegal transition: draft -> shipped rejects without intermediate states"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/domain/mission-lifecycle.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0044` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `npm test -- test/domain/` ``, `` `git diff --stat` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but **must** be paired with one of the accepted references above. Shell output alone (e.g., "ls shows 12 files in src/domain/") is not sufficient evidence — pair it with a file:line reference or test name.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Domain types under src/domain/ with no infra imports | `src/domain/mission.ts:1-85`, `test/domain/import-boundary.test.ts` | PASS |
| Authority map supersedes MACHINE_WRITTEN_PATH_INVENTORY | `src/domain/authority-map.ts:12`, `src/platform/runtime/lib/core/durable-state-inventory.ts:10` | PASS |
| State machine rejects illegal transitions | `test/domain/mission-lifecycle.test.ts`, `"illegal transition: draft -> shipped rejects without intermediate states"` | PASS |
| Sync/async seam proven on agent selection path | `src/domain/snapshot.ts:34`, `test/domain/sync-async-seam.test.ts` | PASS |
| ADR 0044 rewritten with the current persistence direction and seam decision | `docs/adr/0044-workflow-distribution-model.md:107`, `:169` | PASS |
| Verification gate passed | `./scripts/verify-local.sh all` | PASS |

## Gates

- [ ] `./scripts/verify-local.sh all`
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas

- `src/adapters/sqlite/` — no new files or modifications (SQLite work is TASK-2295).
- `assets/migrations/` — no new migration files.
- `src/platform/runtime/lib/core/durable-state-inventory.ts` — may be superseded by the authority map but is not deleted; the `MACHINE_WRITTEN_PATH_INVENTORY` constant remains until TASK-2295 removes it.
- `lib/` — no behavior changes to existing command modules (the seam is proven, not wired).
- `backlog/tasks/` — no changes to task authority or write paths.
- `src/domain/` — new files only; the existing `README.md` is updated in place.

## Stop Rules

- Stop and return to review if the domain model introduces more than 2 entities without a present consumer (file:line trace to a current read/write or board-catalogued query).
- Stop and return to review if the sync/async seam proof requires modifying more than 3 files in `src/platform/runtime/lib/agents/` (the proof is on one consumer path, not a full rewire).
- Stop and return to review if ADR amendments exceed the scope of compacting the seam decision and correcting misstated current reality (no new ADR, no appended history).
- Stop and return to review if `./scripts/verify-local.sh all` or `./scripts/verify-local.sh static-analysis` fails on the final tree.
- Stop if the model work reveals that the deferred task-authority question cannot be represented as a swappable adapter seam (this requires a separate ADR, not a model change).

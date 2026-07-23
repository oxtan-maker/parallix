# Mission: Build operator board projections, events, and guarded controller (task-2281)

## Goal
Implement the UI-neutral board read model and guarded command controller that both Ink and web clients will consume. The projection reads current repository authorities and operator-local event history. Every mutation goes through the same validated application use case used by the CLI. Initially this exposes only the `active` execute-launch lifecycle; draft, checkpoint, review, act-on-findings, approve, and integrate remain visible as unavailable capabilities with a reason until separate bounded extraction missions land.

## Why Now
ADR 0051 (UI-neutral application boundary) is accepted and defines the Hexagonal Architecture ports-and-adapters boundary for extracted behavior. TASK-2280 (bounded SQLite operator state and migrations) is active and provides the operator-local event history foundation. Without this board read model and guarded controller, Ink and web clients have no shared application surface and will either duplicate lifecycle policy or bypass the existing CLI handlers — the primary driver of the 30.2% completed-mission bug frequency documented in ADR 0051. The `active` slice is the highest-impact proof slice because it exercises preflight, launch-before-record, rollback, handoff, and exit semantics.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: new versioned projection types with version fields, guarded command controller with capability-gated dispatch, operation events with stable IDs and cancellation, no-bypass boundary enforcement test, expanded unit test coverage for attention ranking tie-breakers, metric fallbacks, and stale-command rejection

## Scope
- Versioned board projection types (`BoardProjection` with `version` field) covering repository identity, backlog/refined/active/review/integrate/shipped stages, checkpoints, gates, reviews, agents, attention reasons, and available actions
- Deterministic attention ranking with documented tie-breaker rules (proximity to completion, then severity, then mission ID)
- Time-based metrics (WIP counts, median state times, cumulative-flow, throughput, review-loop rate) derived from recorded events with explicit missing-history fallback behavior
- Versioned command controller exposing only the integrated `active` application use case; all other lifecycle actions (draft, checkpoint, review, act-on-findings, approve, integrate) return typed `unavailable` capability results
- Available actions derived from application policy capability results, not UI guesses
- Progress events and final results sharing stable operation IDs with cooperative cancellation at declared safe boundaries
- Stale and invalid command rejection with typed `conflict` results
- Rebuildable repository projections where Git and canonical task/mission documents always win over database projections
- No-bypass test proving the controller does not spawn CLI commands, import legacy handlers, write Markdown/Git/SQLite directly, or implement unowned lifecycle transitions
- Unit tests for every projection stage, attention reason, metric fallback, stale command, invalid transition, and progress-event ordering — all mocked, no real subprocesses

## Out of Scope
- Implementing, wrapping, or extracting any lifecycle action beyond `active` (draft, checkpoint, review, act-on-findings, approve, integrate remain unavailable)
- SQLite authority cutover for task/mission state (remains Markdown/Git until ADR 0044 cutover mission)
- Ink or web UI rendering (this mission ships the application services only)
- HTTP transport, multi-user authorization, or web security model
- Bug-frequency cohort measurement (that is TASK-2291)
- Full migration of all `lib/` modules to the application boundary (that is TASK-2289/TASK-2290)
- Modifying the existing `active` CLI command's text output, JSON contract, or exit codes

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: A `BoardProjection` type with a `version` field exists in `src/application/projections/` and contains `repositoryId`, `stages` (backlog, refined, active, review, integrate, shipped), `attentionQueue`, `wipCounts`, `availableActions`, and `operationLog`
- SC2: `attentionRank` returns deterministic numeric ranks: 0 for blocking reason present, 1 for gate failed, 2 for review lane, 3 for integrate lane, 4 for all others; ties broken by `missionId` ascending (verified by `attentionQueue` sort)
- SC3: Cumulative-flow, median state times, throughput, and review-loop rate projections each declare a `missingHistoryFallback` property specifying the exact behavior when event history is incomplete (e.g., `null`, `estimate`, or `skip`)
- SC4: The guarded command controller exposes `active:execute` as an available capability and returns `rejected` with `kind: 'capability'` for draft, checkpoint, review, act-on-findings, approve, and integrate commands
- SC5: Available actions are capability results with `{ command, enabled, reason }` shape from application policy; no UI module (`ink`, `react`, `node:react`) is imported by any projection or controller module
- SC6: Progress events carry a stable `operationId` string; cancellation at safe boundaries produces `ApplicationOutcome` with `status: 'cancelled'` and `error.kind: 'cancelled'`; post-boundary cancellation returns durable partial state
- SC7: Stale commands (mission status changed since request) return `ApplicationOutcome` with `status: 'failed'` and `error.kind: 'conflict'` carrying a safe operator message
- SC8: Projection rebuild is tested: when Git/task-markdown facts differ from a cached projection, the projection returns the repository authority values with `SourceFact.status: 'fresh'` or `SourceFact.status: 'stale'` as appropriate
- SC9: Unit tests exist under `test/` covering: every `BoardLane` mapping, all 5 `attentionRank` tiers with tie-breaker, every metric fallback path, stale command rejection, invalid transition for each unavailable capability, and progress-event sequence ordering — all without real subprocesses, Forgejo, or agent launches
- SC10: `./scripts/verify-local.sh all` passes; `./scripts/verify-local.sh static-analysis` passes (ESLint + tsc --checkJs + test-hygiene) as the required integration gate for changes under `src/`
- SC11: A no-bypass test (e.g., `test/board-no-bypass.test.ts`) fails if the controller imports `node:child_process`, `node:fs`, any legacy command handler under `src/platform/runtime/lib/commands/`, or implements a lifecycle transition not owned by an integrated application use case

## Risks and Assumptions
- TASK-2280 (SQLite operator state) must complete its migration and adapter foundation before this mission needs operator-local event history reads; if SQLite is not ready, the event history adapter falls back to file-based reads with explicit `SourceFact.status: 'stale'` labeling
- The `active` application use case (`src/platform/runtime/lib/application/active-service.ts`) must already have its ports characterized; if its ports are incomplete, this mission adds only the narrow ports needed by the controller and leaves broader extraction to TASK-2290
- The existing `mission-board.ts` projection types are extended with version fields rather than replaced; backward compatibility with existing tests is preserved
- ADR 0051 dependency direction rules are enforced only for newly authored modules; existing `lib/` modules retain their current import patterns until TASK-2289 migrates them

## Checkpoints
- CP 1: Define versioned projection types (`BoardProjection`, `BoardStage`, `AttentionReason`, `MetricSeries`) and guarded command controller types (`BoardCommandRequest`, `BoardCommandResult`, `OperationEvent`). Verify types compile and satisfy ADR 0051 dependency direction.
- CP 2: Build read adapters over task, mission, review, gate, agent, and Git authorities; implement deterministic attention ranking with tie-breaker tests. Verify `attentionQueue` ordering across all 5 tiers.
- CP 3: Implement time-based metrics (WIP, median state times, cumulative-flow, throughput, review-loop rate) with explicit missing-history fallback behavior. Verify every fallback path has a targeted test.
- CP 4: Implement guarded command controller dispatching only `active:execute`; all other commands return typed `unavailable` capability results. Implement stable operation IDs, progress events, and cooperative cancellation. Verify stale-command rejection and no-bypass boundary test.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/application/projections/mission-board.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"attentionRank returns 0 for blocking reason"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/board-projections.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0051` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `npm test -- test/board-projections.test.ts` ``, or `` `git diff --stat` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| BoardProjection type with version field | `src/application/projections/board.ts:12`, `BoardProjection` interface | PASS |
| attentionRank deterministic with tie-breaker | `test/board-projections.test.ts`, `"attentionQueue sorts by rank then missionId"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/platform/runtime/lib/commands/active.ts` — the existing CLI command handler is not modified; the controller delegates through its application use case
- `src/platform/runtime/lib/commands/` (all) — no legacy command handler is imported by the controller or projections
- `src/domain/` — domain types are not extended with board-specific fields; projections compose domain types without mutating them
- `test/` files for existing commands — do not modify tests for `active`, `checkpoint`, `review`, etc. unless adding new test cases that verify board projection invariants
- `src/entry/px.ts` — the composition root is not modified
- `config/` and `workflow.config.json` — no configuration changes

## Stop Rules
- If TASK-2280 has not delivered the SQLite operator-local event history adapter by CP 3, pause metrics implementation and complete projection types and controller first; record the deferral in CP 3 document
- If the `active` application service ports are not characterized, scope the controller to dispatch through the existing `ActivePort` without expanding it; do not implement new ports for unextracted lifecycle actions
- If adding version fields to `mission-board.ts` breaks more than 3 existing tests, the breakage is investigated before proceeding; do not force-merge
- If the no-bypass test reveals the controller must import a legacy module to function, stop and record the dependency in the checkpoint document; do not add the import without an ADR 0051-compliant port
- If `./scripts/verify-local.sh static-analysis` fails on the final tree, the mission is not complete; fix or scope the change

# Mission: Implement concrete repository read-adapters as the single board materialization path (task-2302)

## Goal

Implement the six concrete read-adapter classes (`MissionReadAdapter`, `ReviewReadAdapter`, `GateReadAdapter`, `AgentReadAdapter`, `GitReadAdapter`, `OperationLogReadAdapter`) that populate the board projection from live authorities (backlog Markdown, Git review-state, gate results, agent config, SQLite operational history), wire them through `BoardProjectionBuilder`, and retire the legacy `status` command's ad-hoc board assembly so exactly one function materializes a domain `Mission` and one materializes a domain `Review`.

## Why Now

TASK-2281 defined the read-adapter port interfaces and `BoardProjectionBuilder` but shipped no concrete implementations (every test injects a fake). TASK-2294 delivered `materializeBacklogMission()` as pure code that reconciles a parsed `BacklogMissionRecord` into a domain `Mission` without touching `node:fs` or Git. TASK-2295 implemented SQLite for operator-local state. The chain is broken: nothing goes from the live authorities (`backlog/tasks|completed|archive/*.md`, mission worktrees, `.workflow`/review-state, gate results, agent config) into the domain objects the projection consumes. TASK-2282 (Ink TUI) depends on this mission and would absorb this scope and re-run the TASK-2280 cascade if it is not delivered first.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: six concrete adapter classes to implement, legacy `status` retirement with output-contract preservation, composition-root wiring, single-path guardrail test, unit tests per adapter, and integration-base-vs-worktree reconciliation test

## Scope

- Concrete `MissionReadAdapter`: reads `backlog/tasks|completed|archive/*.md` frontmatter via existing parse primitives (`resolveTaskFile`, `getTaskStatus`, `getTaskAssignee`, `getTaskFrontmatterValue` from `src/platform/runtime/lib/tools/backlog.ts`), reads mission worktree/checkpoint content via `findMissionDir`/`findCheckpoints` from `src/platform/runtime/lib/core/mission-utils/paths.ts`, reconciles integration-base vs worktree per ADR 0051 materialization contract using `materializeBacklogMission()` from `src/adapters/backlog/mission-materialization.ts`, returns domain `Mission` objects with source facts.
- Concrete `ReviewReadAdapter`: materializes domain `Review` rounds/approval from Git-owned review-state via `readReviewState()` from `src/platform/runtime/lib/review/review-state.ts`, returning typed unavailable/missing results.
- Concrete `GateReadAdapter`: materializes latest gate status from integration pipeline results, returning typed unavailable/missing results.
- Concrete `AgentReadAdapter`: reads agent availability and timed-block countdown from TASK-2295 operator-local SQLite snapshot (blocklist/usage repositories), not by re-reading files ad hoc.
- Concrete `OperationLogReadAdapter`: reads from `SqliteOperationalHistoryRepository.findAll()` (`src/adapters/sqlite/operational-history-repository.ts`), the TASK-2295 snapshot.
- Concrete `GitReadAdapter`: supplies repository identity and HEAD commit for staleness checking.
- Composition root wiring: the full `BoardProjectionBuilder` is instantiated over these concrete adapters in `src/entry/px.ts`.
- Legacy `status` command retirement: re-implement the ad-hoc board assembly in `src/platform/runtime/lib/commands/status.ts` (the `getTaskStatus`/`findCheckpoints`/`getPrStatus`/`findStaleMissionWorktrees` glue at lines 107-219) over the new projection, preserving its existing output contract by characterization test.
- Single-path guardrail test: fails if any module outside the adapters assembles a mission/board/status projection.
- Repository-wins test: proves concrete adapters prefer committed integration-base/Git state over any SQLite or board cache.
- Unit/integration tests for each concrete adapter, the reconciliation logic, missing/unavailable sources, and the guardrail.

## Out of Scope

- No new database tables or schema changes for missions, reviews, or gates (ADR 0044/0051: repository state wins, no dual-write).
- No write path, lifecycle transition, or mutation use case beyond what TASK-2281/2290 already integrated.
- No new typed board-event schema or event-emitting WRITE path (that is TASK-2303).
- The low-level parse primitives (`resolveTaskFile`, `getTaskStatus`, `getTaskAssignee`, `getTaskFrontmatterValue`, `readReviewState`, `findMissionDir`, `findCheckpoints`) are NOT removed, NOT made async, and their non-board command consumers are NOT changed.
- Converting the ~15 command consumers of `getTaskStatus` to async or routing them through the domain model.
- SQLite migration for mission/review/gate domain state (deferred to ADR 0044 cutover).
- Ink TUI rendering (TASK-2282).

## Success Criteria

- SC1: `MissionReadAdapter` returns domain `Mission` objects for all tasks in `backlog/tasks|completed|archive/*.md`; `loadAllMissions()` and `loadMission(id)` are implemented and `getSourceFacts()` returns non-empty source facts.
- SC2: `materializeBacklogMission()` from `src/adapters/backlog/mission-materialization.ts` is the single function that produces a domain `Mission`; integration-base vs worktree reconciliation follows ADR 0051 rules (integration-base owns status/assignee, worktree provides newer content, `done` + worktree-present = unclosed).
- SC3: `ReviewReadAdapter.loadReview()` returns a domain `Review` or null; `loadReviewApproval()` returns typed approval data or null; no invented lifecycle state.
- SC4: `GateReadAdapter.loadGateStatus()` returns `'passed' | 'failed' | 'running' | 'unknown'`.
- SC5: `AgentReadAdapter.loadAgentAvailability()` returns `AgentAvailability[]` from SQLite blocklist/usage snapshot; `loadAssignedAgent()` returns `AgentFamily | null`.
- SC6: `OperationLogReadAdapter.loadOperationLog()` returns entries from `SqliteOperationalHistoryRepository.findAll()`.
- SC7: `GitReadAdapter.loadRepositoryId()` returns `RepositoryId`; `loadHeadCommit()` returns HEAD sha string.
- SC8: `BoardProjectionBuilder.build()` is wired in `src/entry/px.ts` over all six concrete adapters and returns a `BoardProjection`.
- SC9: The legacy `status` command assembly in `src/platform/runtime/lib/commands/status.ts:107-219` is re-implemented over the projection or removed; a characterization test proves its output contract is preserved.
- SC10: A guardrail test fails if any module outside the read adapters assembles a mission/board/status projection.
- SC11: A test proves the concrete adapters prefer committed integration-base/Git state over any SQLite or board cache; a cache never becomes mutation authority.
- SC12: The low-level parse primitives (`resolveTaskFile`, `getTaskStatus`, `getTaskAssignee`, `getTaskFrontmatterValue`, `readReviewState`, `findMissionDir`, `findCheckpoints`) remain synchronous, are not removed, and their non-board consumers are unchanged.
- SC13: Projections are rebuildable from scratch; adapters run with real fixtures (temp repo/worktree) without launching agents, contacting Forgejo, or running expensive external CLIs.
- SC14: `./scripts/verify-local.sh all` passes and `./scripts/verify-local.sh static-analysis` is clean on changed `src/` code.

## Risks and Assumptions

- R1: The legacy `status` command characterization test may reveal output nuances not captured by the current code; risk mitigated by recording exact text before changes.
- R2: Gate results may have no existing file structure if TASK-2281 shipped only the interface; `GateReadAdapter` must handle missing gate artifacts gracefully (returning `'unknown'`).
- R3: `AgentReadAdapter` depends on TASK-2295 SQLite snapshot APIs being stable; if blocklist/usage repository interfaces change, the adapter must be updated in coordination.
- R4: The single-path guardrail test must be carefully scoped to avoid false positives from modules that call parse primitives but do not assemble a board projection.
- A1: `materializeBacklogMission()` is stable and its `BacklogMissionSnapshot` contract is sufficient for the concrete adapter.
- A2: The domain types (`Mission`, `Review`, `AgentAvailability`, `RepositoryId`) from `src/domain/` are finalized enough to use as adapter return types.
- A3: SQLite `operational_history` table exists and `SqliteOperationalHistoryRepository` is available from TASK-2295.

## Checkpoints

- CP 1: Implement concrete `MissionReadAdapter` over existing parse primitives + `materializeBacklogMission`, with unit tests covering all `BacklogMissionMaterializationResult` outcomes (found/unavailable with each failure reason).
- CP 2: Implement concrete `ReviewReadAdapter`, `GateReadAdapter`, `AgentReadAdapter`, `OperationLogReadAdapter`, and `GitReadAdapter`, each with unit tests for normal and missing/unavailable sources.
- CP 3: Wire `BoardProjectionBuilder` in the composition root over all concrete adapters; add integration-base-vs-worktree reconciliation test.
- CP 4: Re-implement (or delete) the legacy `status` board assembly over the projection; add characterization test preserving its output contract.
- CP 5: Add single-path guardrail test and repository-wins test; run `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis`.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/application/projections/board-readers.ts:45` (must point to an existing file and line)
  2. **Test names** — e.g., `"MissionReadAdapter loadAllMissions returns missions from all three backlog stores"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/adapters/mission-read-adapter.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0044` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `npm test -- test/adapters/mission-read-adapter.test.ts` ``, `` `git diff --stat` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Weak-agent failure mode: raw `stat`/`ls` output or generic prose alone is not enough evidence; always pair shell output with a file:line reference, exact test name, test file path, ADR reference, or recognized repo command.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| MissionReadAdapter implements loadAllMissions | `src/adapters/backlog/concrete-mission-read-adapter.ts:12`, `test/adapters/mission-read-adapter.test.ts`, `"loadAllMissions reads from tasks, completed, and archive stores"` | PASS |
| materializeBacklogMission is the single materialization function | `src/adapters/backlog/mission-materialization.ts:88`, `test/adapters/single-path-guardrail.test.ts` | PASS |
| Verification gate ran | `` `./scripts/verify-local.sh all` `` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas

- Do not modify the low-level parse primitives in `src/platform/runtime/lib/tools/backlog.ts` (`resolveTaskFile`, `getTaskStatus`, `getTaskAssignee`, `getTaskFrontmatterValue`) beyond what is needed for the adapters to call them.
- Do not modify `src/platform/runtime/lib/review/review-state.ts` (`readReviewState`) or `src/platform/runtime/lib/core/mission-utils/paths.ts` (`findMissionDir`, `findCheckpoints`) beyond what is needed for the adapters to call them.
- Do not add new database tables or schema migrations for missions, reviews, or gates.
- Do not convert any existing synchronous parse primitive to async.
- Do not change the non-board command consumers of `getTaskStatus` (~15 callers) or add an async cascade into them.
- Do not introduce a write path, lifecycle transition, or event-emitting WRITE side in this mission.

## Stop Rules

- Stop if `materializeBacklogMission()` cannot produce a domain `Mission` from the existing `BacklogMissionSnapshot` contract without changing its API (escalate to TASK-2294 instead of modifying it here).
- Stop if the legacy `status` command characterization test reveals output contract differences that require more than adapter wiring to resolve (scope the gap as a follow-up rather than expanding this mission).
- Stop if implementing the six adapters requires converting synchronous parse primitives to async (defer the async conversion to a separate mission).
- Stop if the single-path guardrail test fires false positives against modules that use parse primitives for non-board purposes (refine the guardrail scope rather than changing those modules).
- Stop if the GateReadAdapter has no gate result file structure to read from (return `'unknown'` and record the gap as TASK-2303 follow-up).

# Mission: Populate board projection data from mission sources (task-2343)

## Goal
Make `px ui` board projections populate their existing checkpoint, gate, pull-request, agent-availability, cycle-time, and operation-log fields from the mission lifecycle’s existing authoritative sources, so cards no longer report unavailable data after the relevant lifecycle evidence exists.

## Why Now
The board already has the `BoardProjectionBuilder`, concrete read adapters, SQLite tables, and TUI fields, but their source contracts are disconnected: one review kind is filtered out, checkpoint metadata is not parsed, expected gate files are never written, and lifecycle events do not reach the existing persistence repositories. This makes a shipped operator surface misleading even for missions that have completed lifecycle steps.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: six projection fields across five concrete adapters; checkpoint markdown parsing; lifecycle-command event persistence into three existing SQLite tables; focused regression coverage.

## Scope
- Add `test/task-2343-board-projection-repro.test.ts` first, using deterministic fixtures/mocks, to demonstrate the current board projection reports unavailable values despite a Forgejo PR reference, checkpoint `Next action:` line and `## Goal Check` table, gate evidence, a usage-limit block, lane transitions, and operation events.
- Correct the review/projection contract so a review that carries a Forgejo PR number projects a non-null `pullRequest` and the card can render `PR #N`.
- Make `ConcreteMissionReadAdapter` parse the latest checkpoint document’s `Next action:` line and its `## Goal Check` table into the existing checkpoint model.
- Connect `ConcreteGateReadAdapter` to gate evidence produced by an existing lifecycle artifact, or make the corresponding lifecycle command write the adapter’s selected gate-status artifact; retain the existing gate-status union.
- Persist lifecycle events from `px active`, `px checkpoint`, `px review`, and `px integrate` through the existing repositories/tables: `agent_blocklist`, `board_lane_events`, and `operational_history`.
- Extend focused adapter, projection, persistence, and command tests without real Forgejo access or expensive agent/CLI invocation.

## Out of Scope
- Changing the `BoardProjection`, `MissionCard`, read-adapter interface, or TUI field shapes.
- Adding SQLite tables or changing the schema authority of `agent_blocklist`, `board_lane_events`, or `operational_history`.
- TUI rendering/layout work covered by task-2329.
- Forgejo PR-number extraction when no Forgejo instance is configured.
- Backfilling historical SQLite rows or mission artifacts that predate this change.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: A focused test proves that a review with a Forgejo PR reference yields a non-null card `pullRequest` with its PR number, and `test/domain-projections.test.ts` continues to cover the projection policy.
- SC2: Given the latest checkpoint file containing `Next action: <text>` and a `## Goal Check` table with at least one row, `ConcreteMissionReadAdapter` supplies that text as `checkpoint.nextActionText` and supplies the table rows as a non-empty `checkpoint.goalCheck` array.
- SC3: A mission with lifecycle gate evidence returns `passed`, `failed`, or `unknown` from the existing gate-status union according to that evidence; it is not unconditionally `unknown`.
- SC4: A recorded agent usage-limit block is persisted to `agent_blocklist` and projects an agent-availability entry whose `available` and `blockedForMs` values agree with the stored block record.
- SC5: Recorded lifecycle lane transitions are persisted to `board_lane_events`, and `ConcreteMetricsReadAdapter` produces non-null `medianCycleTimeByState.series` values for lanes represented by those events.
- SC6: Lifecycle operation events are persisted to `operational_history`, and `ConcreteOperationLogReadAdapter` returns the recorded recent entries.
- SC7: The implementation uses only existing adapter interfaces and existing SQLite tables, with no `BoardProjection` or `MissionCard` shape change.
- SC8: `./scripts/verify-local.sh all` exits successfully on the final tree, and no focused or bare skipped tests are introduced.

## Risks and Assumptions
- Risk: lifecycle commands have different composition roots, so a persistence write can be omitted from one transition; mitigate with command-level tests that assert all four command paths record their required events.
- Risk: checkpoint formats include both inline `Next action:` lines and heading variants; accept the canonical exact `## Goal Check` table format required by handoff and test the selected `Next action:` form explicitly.
- Risk: event writes could make tests invoke real Forgejo or agents; assume dependencies can be injected and require fast unit tests with mocks only.
- Assumption: the existing SQLite migrations and repository APIs are the intended authorities, and newly created lifecycle evidence need not migrate old mission history.

## Checkpoints
- CP 1: Author `test/task-2343-board-projection-repro.test.ts` before any production fix. Build deterministic mission, review, checkpoint, gate, blocklist, lane-event, and operation-history fixtures representing a completed lifecycle. At the parent commit, assert the board card exposes a Forgejo `PR #N`, parsed next action and Goal Check rows, a concrete gate state, agent availability, non-null cycle-time series, and recent operation entries; these assertions must fail (red) because the current adapters leave the fields unavailable. The same test must pass (green) after the implementation.
- CP 2: Repair the concrete review, mission, and gate adapters or their existing lifecycle artifact writer; extend focused tests for PR projection, checkpoint parsing, and gate derivation.
- CP 3: Wire `px active`, `px checkpoint`, `px review`, and `px integrate` through the existing event persistence paths; extend mocked command/repository tests proving rows reach `agent_blocklist`, `board_lane_events`, and `operational_history`.
- CP 4: Run the required verifier, record final evidence for SC1–SC8, and leave an implementation handoff-ready checkpoint.

Reproduction-Test: test/task-2343-board-projection-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary identifying which adapter or lifecycle writer changed and which success criteria it advances.
- The exact heading `## Goal Check`.
- The exact three-column table header `| Criterion | Evidence | Status |`, with at least one row for every applicable success criterion.
- Evidence must use verifiable forms Parallix already recognizes: file:line references, exact test names, ADR references, test file paths, and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- Raw `stat`/`ls` output or generic prose alone is insufficient—a weak agent must pair shell output with at least one accepted reference above.
- A specific `Next action:` line at the bottom naming the next adapter, lifecycle command, test, or verifier to run.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Checkpoint parser reads next action and Goal Check rows | `src/adapters/backlog/concrete-mission-read-adapter.ts:1`, `test/task-2343-board-projection-repro.test.ts` | PASS |
| Lifecycle history reaches board metrics and operation log | `src/application/recording/board-event-recorder.ts:1`, `./scripts/verify-local.sh all` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change `src/interfaces/tui/` rendering or layout code.
- Do not add or alter SQLite migration files, table definitions, or read-adapter interfaces.
- Do not access a real Forgejo instance, launch coding agents, or add slow integration tests; unit tests must mock dependencies.
- Do not change mission ownership (`assignee`) in the backlog task.

## Stop Rules
- Stop and request direction if satisfying a criterion requires a new board projection field, a new read-adapter interface, a new SQLite table/migration, or TUI rendering changes.
- Stop and request direction if a lifecycle source cannot provide the required data without querying an unconfigured real Forgejo instance.
- Stop and request direction if deterministic mocked tests cannot cover a lifecycle command without invoking a real agent or expensive external CLI process.

# CP-2: Focused single-mission projection implemented and wired

## Summary of work done

Added `BoardProjectionBuilder.buildMissionCard(missionId)` in
`src/application/projections/board-readers.ts`. It reads only what one mission's card needs:

- `MissionReadAdapter.loadMission(id)` (the port already declared it; the board route was
  simply never using it),
- `ReviewReadAdapter.loadReviews([id])` — already id-scoped in both
  `ConcreteReviewReadAdapter` and `SqliteReviewProjectionReader`,
- `GateReadAdapter.loadGateStatus(id)`,
- the two repository-wide published-fact reads `loadRunningSessions()` and
  `loadCurrentWork()`, reconciled through the same `reconcileCurrentWork` call shape
  `build()` uses. These are single fact queries, not per-mission materialisations.

It does **not** call `loadAllMissions()`, `loadOperationLog()`, `loadRepositoryId()`,
`loadAgentAvailability()`, `buildMetrics()`, `deriveAvailableActions()` or
`buildBoardProjection()`. It returns `null` for a mission that does not exist.

To keep one ruleset for lifecycle and review interpretation, the per-mission body of
`build()` was extracted into a private `composeCard(mission, reviewFact, latestGate, work,
liveSession)` that both routes call; it is the only place `MissionOperationalFacts` is
assembled and `projectMissionCard` is invoked. The `liveSession` `undefined` vs `null`
distinction ("liveness unknown" vs "observed nothing running") is preserved, and the
`noCurrentWork` local became the module constant `NO_CURRENT_WORK`. `build()`'s observable
behaviour is unchanged — this is the minimal shared extraction the Restricted Areas allow,
not a board-builder optimisation.

`createStatusBoardAdapter.getMissionData` in `src/adapters/cli/commands/status-adapter.ts`
now calls `builder.buildMissionCard(slug.toLowerCase())` instead of `builder.build()` plus a
scan of `projection.stages.flatMap(s => s.cards)`. The slug is lowercased at the boundary,
preserving the previous case-insensitive card match. This is the port the live CLI wires in
`src/composition/create-cli.ts` (`status:` registry entry). No CLI-local lifecycle or review
semantics were added: `getMissionData` still only reshapes the card into `StatusMissionData`
and calls the shared `projectMissionActivity`.

Deliberately untouched: the no-slug repository-level route (`BoardProjectionBuilder.build()`
and the legacy `createStatusWorkflowAdapter` monolithic port), so nothing outside the
explicit-slug path changed.

Verification at this checkpoint:

- `npx tsx --test test/task-2402-focused-mission-status.test.ts` — 8 tests, 8 pass, 0 fail
  (all four CP-1 read-boundary tests are now green).
- `npx tsx --test test/board-readers.test.ts test/board-readers.worktree-amplification.test.ts test/status-command-use-case.test.ts test/task-2332-status-review-history.test.ts test/task-2344-review-history-status-repro.test.ts test/board-projections.test.ts` — all pass.
- `npx tsx --experimental-test-module-mocks --test test/status.test.ts` — 14 tests, 14 pass.
  (Without that flag the file aborts on `mock.module is not a function`, which is the runner
  flag the project's own `test/run-default-tests.ts` supplies, not a behaviour failure.)
- `npx tsc --noEmit` — clean.
- `npx eslint src/application/projections/board-readers.ts src/adapters/cli/commands/status-adapter.ts test/task-2402-focused-mission-status.test.ts` — clean.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `px status <slug>` obtains the mission without `BoardProjectionBuilder.build()` / `loadAllMissions()` | `BoardProjectionBuilder.buildMissionCard` in `src/application/projections/board-readers.ts`, called by `createStatusBoardAdapter` in `src/adapters/cli/commands/status-adapter.ts`; test `"explicit-slug status never loads every mission to find the selected one"` passes via `npx tsx --test test/task-2402-focused-mission-status.test.ts` | Green |
| Explicit-slug result stays correct for activity, lifecycle/backlog state, latest checkpoint, review round/phase/disposition/history, approval owed, and retained global fields | Tests `"focused mission status returns the established status contract fields"`, `"focused mission status reports the selected mission activity only"`, `"focused mission status matches the board projection card for the same mission"` in `test/task-2402-focused-mission-status.test.ts`; interpretation shared through `composeCard` → `projectMissionCard` | Green |
| Unrelated-mission fixture proves those missions are neither materialised nor read; assertion observes the read boundary, not time | Tests `"explicit-slug status does not materialize unrelated missions"` and `"explicit-slug status skips board-wide operation log and metrics reads"` in `test/task-2402-focused-mission-status.test.ts` assert recorded `loadAllMissions` / `loadMission` / `loadReviews` / `loadGateStatus` / `loadOperationLog` / `loadRepositoryId` / `loadAgentAvailability` calls | Green |
| `px status` without a slug retains repository-level behaviour under existing coverage | `npx tsx --test test/board-readers.test.ts test/board-projections.test.ts test/status-command-use-case.test.ts` all pass; test `"board projection build still reads every mission for the no-slug status path"` in `test/task-2402-focused-mission-status.test.ts` pins `build()` still reading every mission plus the operation log and repository identity | Green |
| `./scripts/verify-local.sh all` passes on the final tree | Deferred to CP-3; command is `./scripts/verify-local.sh all`. Interim: `npx tsc --noEmit` and `npx eslint` clean on all changed files | Pending |

Next action: run `./scripts/verify-local.sh all` on the committed tree, refresh the knowledge graph with `graphify update .`, and record the final gate evidence in `missions/task-2402/CP-3.md`.

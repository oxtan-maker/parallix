# CP-1: Explicit-slug status flow mapped, read-boundary tests added (red)

## Summary of work done

Traced the live `px status <slug>` path end to end:

- `src/composition/create-cli.ts` registers `status` and builds the board port via
  `createStatusBoardAdapter({ buildProjectionFn })`, backed by
  `services.presentationCapabilities.boardProjection`.
- `src/interfaces/cli/status.ts` parses args and renders `StatusResult`.
- `src/application/status-command-use-case.ts` (`StatusCommandUseCase.execute`) calls
  `StatusBoardPort.getMissionData(slug, rootDir)` whenever a slug resolves.
- `src/adapters/cli/commands/status-adapter.ts` (`createStatusBoardAdapter`) is the
  full-board read boundary: it calls `BoardProjectionBuilder.build()` and then scans
  `projection.stages.flatMap(s => s.cards)` for one card.

`BoardProjectionBuilder.build()` (`src/application/projections/board-readers.ts`) performs
`loadAllMissions()`, a board-wide `loadOperationLog()`, `loadRepositoryId()`,
`loadAgentAvailability()`, a per-mission `loadGateStatus()` for every mission, and metrics
assembly — all of which an explicit-slug request pays for today.

Fields the explicit-slug contract must retain (from `StatusMissionData` in
`src/application/ports/cli-workflows.ts` and rendered by `renderStatus`): `backlogStatus`,
`checkpoint`, `checkpointDescription`, `reviewPhase`, `reviewRound`, `reviewDisposition`,
`approvalOwed`, `reviewHistory`, and `activity`. Genuinely global/mission-local fields
supplied by the other status ports (branch, rebase, Forgejo PR, agent matrix, commits,
uncommitted count) are untouched by this mission's read boundary.

Added `test/task-2402-focused-mission-status.test.ts`: a fixture board holding the selected
mission plus four unrelated missions (`task-9001`..`task-9004`), with a recording
`MissionReadAdapter`, `ReviewReadAdapter`, `GateReadAdapter`, `GitReadAdapter` and
`OperationLogReadAdapter`. The assertions observe *which adapter calls happen*, never elapsed
time.

Current state, via `npx tsx --test test/task-2402-focused-mission-status.test.ts`: 8 tests,
4 pass, 4 fail. The four failures are the read-boundary tests, red against the board-wide
route exactly as CP-1 requires:

- `"explicit-slug status never loads every mission to find the selected one"` — `loadAllMissions` called once (expected 0)
- `"explicit-slug status does not materialize unrelated missions"` — materialized `task-9001..task-9004` (expected only `task-2402`)
- `"explicit-slug status skips board-wide operation log and metrics reads"` — `loadOperationLog` called once (expected 0)
- `"focused mission status returns null for a mission that does not exist"` — `loadAllMissions` called once (expected 0)

The four already-green tests pin the contract that CP-2 must not break, including
`"focused mission status matches the board projection card for the same mission"`, which
compares the focused result field-by-field against the board card, and
`"board projection build still reads every mission for the no-slug status path"`, which
locks in that the repository-wide path is unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `px status <slug>` obtains the mission without `BoardProjectionBuilder.build()` / `loadAllMissions()` | Test `"explicit-slug status never loads every mission to find the selected one"` in `test/task-2402-focused-mission-status.test.ts`; run `npx tsx --test test/task-2402-focused-mission-status.test.ts` — currently red against the board-wide route in `src/adapters/cli/commands/status-adapter.ts` (`createStatusBoardAdapter`) | Red (expected at CP-1) |
| Explicit-slug result stays correct for activity, lifecycle/backlog state, latest checkpoint, review round/phase/disposition/history, approval owed, and retained global fields | Tests `"focused mission status returns the established status contract fields"`, `"focused mission status reports the selected mission activity only"`, and `"focused mission status matches the board projection card for the same mission"` in `test/task-2402-focused-mission-status.test.ts` — all green today, so CP-2 cannot regress them | Green |
| Unrelated-mission fixture proves those missions are neither materialised nor read; assertion observes the read boundary, not time | Tests `"explicit-slug status does not materialize unrelated missions"` and `"explicit-slug status skips board-wide operation log and metrics reads"` in `test/task-2402-focused-mission-status.test.ts` assert on recorded `loadAllMissions` / `loadMission` / `loadReviews` / `loadGateStatus` / `loadOperationLog` calls | Red (expected at CP-1) |
| `px status` without a slug retains repository-level behaviour under existing coverage | Test `"board projection build still reads every mission for the no-slug status path"` in `test/task-2402-focused-mission-status.test.ts`, plus existing `test/board-readers.test.ts` and `test/status-command-use-case.test.ts` | Green |
| `./scripts/verify-local.sh all` passes on the final tree | Deferred to CP-3; command is `./scripts/verify-local.sh all` | Pending |

Next action: add a focused single-mission card projection to `BoardProjectionBuilder` in `src/application/projections/board-readers.ts` (reusing `projectMissionCard`, `loadMission`, per-id `loadReviews`, `loadGateStatus`, and `reconcileCurrentWork`) and wire only `createStatusBoardAdapter` to it, turning the four red tests in `test/task-2402-focused-mission-status.test.ts` green.

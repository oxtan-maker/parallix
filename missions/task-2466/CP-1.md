# CP-1 — Trace the cancellation path and fix the implementation shape

## Summary

Traced every flow `mission:cancel` has to travel and confirmed the mission-scoped table
inventory against the live schema. No code changed in this checkpoint.

### Command vocabulary and dispatch

- `BoardCommandKind` and `INTEGRATED_CAPABILITIES` both live in
  `src/application/controller/board-command.ts`; `BoardCommandController`
  (`src/application/controller/board-controller.ts`) is the single guarded dispatcher, and
  `composeProductionCapabilities` (`src/composition/production-capabilities.ts`) builds exactly one
  instance that the CLI, the TUI and `px web` all share.
- Per-kind use cases reach the controller through `BoardMissionServices`. `integrate:merge` and
  `draft:create` already use the narrow `executeForSlug(slug)` shape, so cancellation needs no new
  abstraction: one more optional member on the existing interface (Stop rule 3 does not apply).

### Surfaces

- **CLI** — `KNOWN_COMMANDS` in `src/interfaces/cli/runtime.ts` plus the command table in
  `src/composition/create-cli.ts`. `active` already dispatches through the controller
  (`withActiveService`), so a `px cancel <slug>` entry follows that precedent.
- **TUI** — `src/interfaces/tui/shell.tsx` owns the keyboard router and the single
  `confirmationArmedRef`, which confirms on unmodified Enter. Ordinary lifecycle confirmation is
  therefore *Enter*, so the destructive confirmation must be a different key (G4).
- **Web** — `Board` in `web/src/board.tsx` dispatches on one click via `sendCommand`, and cards
  render the first enabled action (`primaryAction` in `web/src/flight-column.tsx` and
  `web/src/intake-column.tsx`). Cancel therefore needs its own button plus a second, explicitly
  labelled confirmation step, and must be excluded from `primaryAction`.
- Wire vocabulary lives in `src/interfaces/web/transport.ts`: `WebBoardCommandKind`,
  `BOARD_COMMAND_KINDS` and `WebCommandRequestKind`; the projection's `BoardCommand` vocabulary and
  `availableBoardCommands` live in `src/application/projections/mission-board.ts`.

### Database

- `SqliteDatabaseAdapter` (`src/adapters/sqlite/database-adapter.ts`) enables
  `PRAGMA foreign_keys = ON` on open and exposes `beginTransaction` / `commitTransaction` /
  `rollbackTransaction`. `SqliteMissionStore.saveAggregate` is the existing begin/try/rollback
  pattern the cancel will copy.
- Advisory git cleanup is built from `missionBranchName` (`src/adapters/filesystem/mission-paths.ts`)
  and `resolveWorktree` / `conventionalWorktreePath` (`src/adapters/filesystem/mission-utils.ts`),
  matching the `git worktree remove <path> && git branch -D <branch>` string
  `src/adapters/cli/commands/status.ts` already builds for stale worktrees.

### Mission-scoped table inventory (Stop rule 2 check)

Cascaded from `missions` (`0004-mission-aggregate.sql`, `0005-mission-external-task-ref.sql`,
`0008-review-workflow-state.sql`, `0010-review-events-and-implementer-response.sql`):
`mission_labels`, `mission_checkpoints`, `mission_checkpoint_goal_checks`, `mission_reviews`,
`mission_review_rounds`, `mission_review_findings`, `mission_review_resolutions`,
`mission_review_stage_launches`, `mission_review_events`, `mission_external_task_refs`.
Un-cascaded and deleted explicitly: `session_markers`, `board_lane_events`.

Three further tables carry a mission column but are **history, not lifecycle**, and are preserved:
`usage_statistics` (contract requirement), `legacy_usage_completion_evidence`
(`0014-remove-usage-closed.sql`, a frozen copy of historical usage evidence), and
`operational_history` (`0015-current-work-latest-per-mission.sql` indexes `missionId` inside the
JSON payload). `BoardProjectionBuilder.build` joins current-work facts onto missions it has already
loaded, so an operational_history row for a deleted mission is never projected. No lifecycle table
exists outside the contract inventory, so Stop rule 2 does not fire.

### Selected implementation path

1. `SqliteMissionStore.cancel(missionId)` runs the fixed delete list in one transaction, asserting
   `PRAGMA foreign_keys` is on before deleting and `PRAGMA foreign_key_check` is empty before commit.
   `cancel?` becomes an optional member of the existing `MissionStore` port — no new interface (G6).
2. One application use case (`MissionCancelService`) calls that port method and returns the advisory
   cleanup command; it is registered on `BoardMissionServices` beside `integrate`.
3. `BoardCommandController.dispatch` gains a `mission:cancel` branch; CLI/TUI/web each build a
   request whose payload is the mission id only.

### Known consequence, recorded deliberately

Board cards are projected from the Backlog task markdown as well as the store
(`ConcreteMissionReadAdapter.loadAllMissions`). Restricted Areas forbid mutating Backlog task files,
so after a cancel the persisted aggregate, its lane history and its review state disappear, while a
card may re-project from the task file at whatever status the file records. Moving the Backlog task
back to `backlog` stays an operator step and will be documented in CP-4 alongside the git cleanup.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `mission:cancel` is a `BoardCommandKind`, appears in `INTEGRATED_CAPABILITIES`, carries only the mission id, and is the sole database path for all three surfaces | Located the single vocabulary and the single dispatcher in `src/application/controller/board-command.ts` and `src/application/controller/board-controller.ts`, both reached through the one controller built by `composeProductionCapabilities` in `src/composition/production-capabilities.ts` | Traced |
| Cancelling removes rows for the id from the 13 named lifecycle tables | Inventory confirmed against `src/adapters/sqlite/migrations/0004-mission-aggregate.sql`, `0005-mission-external-task-ref.sql`, `0006-session-markers.sql`, `0008-review-workflow-state.sql`, `0010-review-events-and-implementer-response.sql`, `0011-board-lane-events-repository-id.sql` | Traced |
| Non-target missions stay unchanged | Existing fixture pattern for multi-mission SQLite state: `test/task-2322-05-mission-sqlite-fixture.test.ts` | Planned in CP-2 |
| `usage_statistics` count and summed `cost_usd` preserved | `usage_statistics.mission` has no foreign key (`src/adapters/sqlite/migrations/0001-initial-schema.sql`, rebuilt by `0014-remove-usage-closed.sql`); no delete will name it | Traced |
| Transaction verifies `PRAGMA foreign_keys = ON`, commits only on empty `PRAGMA foreign_key_check`, rolls back on induced failure | `SqliteDatabaseAdapter.beginTransaction`/`commitTransaction`/`rollbackTransaction` in `src/adapters/sqlite/database-adapter.ts`; existing begin/try/rollback precedent in `src/adapters/sqlite/mission-store.ts` | Traced |
| TUI and web confirmations are distinct from ordinary lifecycle confirmation | Ordinary confirmation is unmodified Enter (`src/interfaces/tui/shell.tsx` `confirmationArmedRef`) and one click (`web/src/board.tsx` `open`) — both identified as the baselines the cancel confirmation must differ from | Traced |
| Projections drop the cancelled mission without restart; cleanup output is advisory only | `BoardProjectionBuilder.build` in `src/application/projections/board-readers.ts` rebuilds cards per call from `loadAllMissions`; cleanup string construction mirrors `src/adapters/cli/commands/status.ts` | Traced |
| Documentation covers both boards, preserved `usage_statistics`, operator-owned git cleanup | `docs/` gate is `./scripts/verify-local.sh docs`; documentation lands in CP-4 | Planned in CP-4 |
| Stop rules: no migration, no new status, no extra mission-scoped table, no new abstraction | Inventory section above; `MissionStore` in `src/application/domain-ports.ts` already carries optional members (`loadByRepository?`, `drain?`) so `cancel?` adds no interface | Cleared |

Next action: implement `SqliteMissionStore.cancel` plus `MissionCancelService` and add the CP-2 database tests in `test/task-2466-mission-cancel.test.ts` covering target-only deletion, cascades, preserved `usage_statistics`, `PRAGMA foreign_key_check`, and rollback on an induced mid-transaction failure.

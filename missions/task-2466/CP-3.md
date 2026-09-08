# CP-3 — CLI, TUI and web board wired to the one command

## Summary

All three surfaces now reach exactly one dispatcher; none of them touches SQL.

- **CLI** — `px cancel <slug> --yes` (`src/interfaces/cli/cancel.ts`), registered in
  `KNOWN_COMMANDS` and the usage text (`src/interfaces/cli/runtime.ts`) and wired in
  `src/composition/create-cli.ts` to the same `BoardCommandController` the boards use. Without
  `--yes` it prints what cancellation destroys, exits 1, and dispatches nothing.
- **TUI** — `Shift+X` on the selected mission arms a destructive confirmation
  (`src/interfaces/tui/shell.tsx`). It is a separate armed state from the ordinary one: Enter, which
  confirms every other lifecycle command, is ignored; a second `Shift+X` deletes and `Escape`
  dismisses. `ConfirmationDialog` renders the red destructive variant
  (`src/interfaces/tui/confirmation-dialog.tsx`), and `OutcomeBanner` reports the advisory git
  cleanup returned by the command (`src/interfaces/tui/outcome-banner.tsx`). On a completed cancel
  the shell rebuilds the projection in place, so the card leaves the board without a restart.
- **Web** — the card renders a separate red `cancel ✕` button; `primaryAction` in
  `web/src/flight-column.tsx` and `web/src/intake-column.tsx` now excludes `mission:cancel`, so the
  destructive action can never become a card's default button. Clicking it opens a labelled
  confirmation panel in `web/src/board.tsx` with `delete <id> lifecycle rows` and `keep mission`;
  only the first dispatches, and the board refreshes afterwards.
- `missionCleanupCommand` (`src/composition/production-capabilities.ts`) takes an optional `gitFn`
  seam so a test can prove it only ever runs `git worktree list --porcelain`.

Existing expectations updated for the added command: the `BOARD_ACTION_KINDS` count in
`test/tui-action-bar.test.ts` and `test/tui-characterization-cp1.test.ts`, the integration-suite
inventory in `test/default-test-suite.test.ts`, and the `projectMissionCard` citation line in
`src/application/consumer-domain-requirements.ts`.

`npm test` — 2450 tests, 0 failures. `./scripts/verify-local.sh static-analysis` — all four stages
pass. This checkpoint's own coverage: `npx tsx --test test/task-2466-cancel-surfaces.test.ts`
(12 passing).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `mission:cancel` is the sole database path used by the TUI, web board and CLI, and accepts only the mission id | `"dispatches mission:cancel carrying the mission id alone and prints the operator git cleanup"` and `"confirming sends one mission:cancel request and refreshes the board"` in `test/task-2466-cancel-surfaces.test.ts` assert kind, mission id and absent payload on both the CLI request and the browser request body | Done |
| Cancelling removes rows from all 13 lifecycle tables | `"removes every lifecycle row for the cancelled mission id"` in `test/task-2466-mission-cancel.test.ts` | Done |
| A three-mission fixture proves the non-targets are unchanged | `"leaves the other two missions untouched in every lifecycle table"` in `test/task-2466-mission-cancel.test.ts` | Done |
| `usage_statistics` rows and summed `cost_usd` preserved | `"preserves the cancelled mission usage_statistics rows and summed cost_usd"` in `test/task-2466-mission-cancel.test.ts` | Done |
| Foreign keys verified, checked before commit, rollback on induced failure | `"refuses to delete anything when foreign keys are not enabled"`, `"leaves no foreign-key violation behind"`, `"rolls back the whole cancel when a statement fails mid-transaction"` in `test/task-2466-mission-cancel.test.ts` | Done |
| TUI and web cancellation each require a distinct explicit confirmation; dismissal deletes nothing | `"ignores the Enter that confirms every other command and deletes only on a second Shift+X"`, `"dismissing with Escape deletes nothing"`, `"asks before deleting: the card button alone sends no command"` and `"dismissing the confirmation deletes nothing"` in `test/task-2466-cancel-surfaces.test.ts`; the CLI equivalent is `"refuses to dispatch without the explicit --yes confirmation"` | Done |
| Projections remove the cancelled mission without a restart; cleanup output names the worktree path and branch; no git-mutating command is invoked | `"the cancelled mission leaves the board projection without rebuilding the reader"`, `"drops the cancelled mission from the board without a restart"` and `"the cleanup command is built with read-only git and mutates nothing"` in `test/task-2466-cancel-surfaces.test.ts` | Done |
| The destructive action never becomes a card's default button | `"every persisted mission advertises an enabled cancel command, last"` in `test/task-2466-cancel-surfaces.test.ts`, plus the `primaryAction` filter in `web/src/flight-column.tsx` and `web/src/intake-column.tsx` | Done |
| Documentation covers both boards, preserved `usage_statistics`, operator git cleanup | Gate `./scripts/verify-local.sh docs`; documentation lands in CP-4 | Planned in CP-4 |

Next action: document `px cancel`, the TUI `Shift+X` confirmation and the web confirmation panel in `docs/`, stating that `usage_statistics` survives and that branch, worktree and Backlog task cleanup stay the operator's step, then run `./scripts/verify-local.sh docs` and `./scripts/verify-local.sh all`.

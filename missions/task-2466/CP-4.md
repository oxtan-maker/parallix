# CP-4 — Documentation and final gates

## Summary

- `docs/tui-board.md` gained a **Cancelling a mission** section: what a cancel deletes, the three
  ways to reach it (TUI `Shift+X` twice, the web board's `cancel ✕` button plus its
  `delete <mission> lifecycle rows` panel, and `px cancel <slug> --yes`), that the confirmation is
  deliberately different from the ordinary lifecycle confirmation, that recorded usage statistics
  survive, and that removing the branch, the worktree and resetting the Backlog task stay the
  operator's job. Its keyboard table lists `Shift+X`, and the stale "the board assigns no workflow
  actions to `Enter` or other letter keys" claim now describes the confirmation both acting keys go
  through.
- `README.md` gained a short paragraph on `px cancel <slug> --yes` next to the worked example,
  pointing at the board guide.
- Test placement corrected in `test/default-test-suite.test.ts`: both TASK-2466 test files run in
  the integration suite — the database file opens a migrated SQLite fixture, and the surface file
  asserts on advisory cleanup text naming git commands, which the runner's boundary heuristic
  classifies as a git dependency.

### Gate results on the committed tree

| Gate | Result |
|---|---|
| `./scripts/verify-local.sh static-analysis` | PASS — ESLint, `npm run typecheck`, test hygiene, test typecheck |
| `./scripts/verify-local.sh docs` | PASS — authored docs carry no volatile implementation evidence and every relative link resolves |
| `./scripts/verify-local.sh all` | PASS — 2450 tests, 0 failures |
| `npm run test:integration` (not a declared gate; run because this mission's tests live there) | TASK-2466's 19 tests pass. 15 unrelated failures are environmental in this sandbox: the `task-2285` pack/install and web-package smokes fail on a non-writable `~/.npm/_logs`, and `task-2270-graphify-exclusion` fails on a read-only `~/.cache/uv`. None touch the cancel path. |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `mission:cancel` is a `BoardCommandKind`, appears in `INTEGRATED_CAPABILITIES`, accepts only the target mission id, and is the sole database path used by the TUI, web board and CLI | `"INTEGRATED_CAPABILITIES contains active:execute and the Mission commands"` in `test/board-controller.test.ts`; `"dispatches mission:cancel carrying the mission id alone and prints the operator git cleanup"` and `"confirming sends one mission:cancel request and refreshes the board"` in `test/task-2466-cancel-surfaces.test.ts` | Met |
| Cancelling a fixture mission removes rows for its id from all 13 named lifecycle tables | `"removes every lifecycle row for the cancelled mission id"` in `test/task-2466-mission-cancel.test.ts` iterates the `LIFECYCLE_TABLES` list and asserts zero rows each | Met |
| A fixture containing three missions proves the two non-targets are unchanged in every lifecycle table | `"leaves the other two missions untouched in every lifecycle table"` in `test/task-2466-mission-cancel.test.ts` | Met |
| Cancellation preserves the cancelled mission's `usage_statistics` row count and summed `cost_usd` | `"preserves the cancelled mission usage_statistics rows and summed cost_usd"` in `test/task-2466-mission-cancel.test.ts` (2 rows / 2.00 USD before and after) | Met |
| The transaction verifies `PRAGMA foreign_keys = ON`, commits only on an empty `PRAGMA foreign_key_check`, and an induced mid-transaction failure leaves the database unchanged | `"refuses to delete anything when foreign keys are not enabled"`, `"leaves no foreign-key violation behind"`, `"rolls back the whole cancel when a statement fails mid-transaction"` in `test/task-2466-mission-cancel.test.ts` | Met |
| TUI and web cancellation each require their distinct explicit confirmation; dismissing either leaves all target lifecycle rows present | `"ignores the Enter that confirms every other command and deletes only on a second Shift+X"`, `"dismissing with Escape deletes nothing"`, `"asks before deleting: the card button alone sends no command"`, `"dismissing the confirmation deletes nothing"` in `test/task-2466-cancel-surfaces.test.ts`; the CLI's own confirmation is `"refuses to dispatch without the explicit --yes confirmation"` | Met |
| The TUI, web board and CLI projections remove the cancelled mission without restart; the cleanup output contains that mission's worktree path and branch, and no git-mutating command is invoked | `"the cancelled mission leaves the board projection without rebuilding the reader"` (one `BoardProjectionBuilder` across both builds), `"drops the cancelled mission from the board without a restart"`, `"the cleanup command is built with read-only git and mutates nothing"` in `test/task-2466-cancel-surfaces.test.ts` | Met |
| User documentation states how to cancel from both boards, that `usage_statistics` remains, and that the operator performs branch and worktree removal | `docs/tui-board.md` section "Cancelling a mission" and the `px cancel` paragraph in `README.md`, both passing `./scripts/verify-local.sh docs` | Met |
| No schema migration, no new `MissionStatus` or lane value, no new abstraction | No file added under the migrations directory in this mission's diff; `cancel?` is an optional member of the existing `MissionStore` port in `src/application/domain-ports.ts`; the `missions` status `CHECK` constraint is untouched (`git log --oneline mission/task-2466 ^main -- src/adapters/sqlite/migrations` is empty) | Met |
| Verification gate ran and passed on the final tree | `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh docs`, `./scripts/verify-local.sh all` — all pass; see the gate table above | Met |

Next action: hand off task-2466 for review, flagging for the reviewer that a cancelled mission's Backlog task file is deliberately left untouched (Restricted Areas forbid mutating it), so a card can re-project from Markdown at its old status until the operator resets it — documented in `docs/tui-board.md`.

---
id: TASK-2466
title: Cancel a mission from the TUI and web board
status: refined
assignee: []
created_date: '2026-09-07 11:30'
labels:
  - ai_sdlc
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Abandoning a mission currently has no supported path. When a mission goes wrong and the operator
decides to redo it from scratch, deleting the branch and the worktree removes the git side but leaves
the mission alive in the operator database: it keeps its lane on the board, keeps its review rounds
and events, keeps its session markers, and keeps emitting as in-flight work.

There is no `cancel` anywhere in the stack. `MissionCommand` (`src/domain/mission-workflow.ts:21`)
offers only `refine`, `activate`, `submit-for-review`, `request-changes`, `approve`, `integrate`, and
`BoardCommandKind` (`src/application/controller/board-command.ts:15`) exposes no cancellation. The
only way to retire an abandoned mission today is hand-written SQL against `parallix.db`, which the
operator had to do for the abandoned TASK-2462: back up the database, enable `PRAGMA foreign_keys`,
delete the `missions` row so the cascade clears `mission_reviews`, `mission_review_rounds`,
`mission_review_events`, `mission_review_stage_launches`, `mission_checkpoints` and
`mission_checkpoint_goal_checks`, then separately delete the rows in `session_markers` and
`board_lane_events`, which carry no foreign key and are not cascaded.

That procedure is exactly what this task automates, behind a confirmed action on the TUI board and the
web board.

### What cancelling means

Cancellation retires the mission's lifecycle state. It is not a lane transition to a new terminal
status: `MissionStatus` and the `missions` table's `CHECK (status IN (...))` constraint stay as they
are, and no migration adds a `cancelled` value.

A cancel must:

1. Delete the mission's lifecycle rows: the `missions` row (whose `ON DELETE CASCADE` clears
   `mission_labels`, `mission_checkpoints`, `mission_checkpoint_goal_checks`, `mission_reviews`,
   `mission_review_rounds`, `mission_review_findings`, `mission_review_resolutions`,
   `mission_review_stage_launches`, `mission_review_events`, `mission_external_task_refs`) plus the
   un-cascaded rows in `session_markers` and `board_lane_events`.
2. **Preserve `usage_statistics`.** Those rows record tokens actually spent and money actually
   charged; a cancelled mission still cost what it cost, and cost history must not develop holes.
   `usage_statistics.mission` has no foreign key, so this is a matter of not deleting it.
3. Run inside a single transaction with `PRAGMA foreign_keys = ON`, and roll back if
   `PRAGMA foreign_key_check` reports any violation.
4. Leave the git side to the operator, and print the exact commands for it —
   `git worktree remove <path> && git branch -D <branch>` — using the same construction
   `src/adapters/cli/commands/status.ts:98` already uses. Cancellation must not delete branches or
   worktrees itself.

### Surfaces

- **TUI**: a cancel action on the selected mission, routed through the existing board command
  controller and gated by the existing `ConfirmationDialog`
  (`src/interfaces/tui/confirmation-dialog.tsx`). Because cancellation destroys rows rather than
  moving a lane, the confirmation must require a distinct keypress from the ordinary
  lifecycle-command confirmation, so a reflexive `y` on the wrong card cannot delete a mission.
- **Web**: the same action on the mission card, through `web/src/action-button.tsx`, with an
  equivalent explicit confirmation.
- **CLI**: whatever subcommand the two boards dispatch through must also be runnable directly, so the
  operation is scriptable and testable without a terminal UI.

All three go through one `BoardCommandKind` — `mission:cancel` — added to `BoardCommandKind` and to
`INTEGRATED_CAPABILITIES` (`src/application/controller/board-command.ts:139`). No surface may reach
the database except through that command. Its payload carries the mission id and nothing else: no
path, no SQL, no argv.

<!-- SECTION:GUARDRAILS:BEGIN -->
## Guardrails

### G1. Deletion is scoped to one mission id, always

Every statement filters on the target mission id. No statement may delete by lane, status, age,
repository, or any predicate other than that single id. A cancel of `task-2462` must leave every other
mission's row counts unchanged, and a test must assert that against a fixture holding several
missions.

### G2. Transactional, foreign-key-checked, all-or-nothing

The whole cancel runs in one transaction with `PRAGMA foreign_keys = ON` verified as actually enabled
before any delete. Run `PRAGMA foreign_key_check` before commit and roll back on any row. A test must
assert that a failure partway through leaves the database byte-identical to its pre-cancel state.

### G3. `usage_statistics` survives

A test must cancel a mission that has `usage_statistics` rows and assert the row count and summed
`cost_usd` are unchanged afterwards.

### G4. Confirmation is mandatory and distinct

No code path may cancel without an explicit confirmation. The confirmation keypress or interaction
must differ from the one used for ordinary lifecycle commands. A test must assert that dismissing the
confirmation performs no deletion.

### G5. No new terminal status, no migration

Do not add a `cancelled` value to `MissionStatus`, to the `missions` table `CHECK` constraint, or to
the `board_lane_events` status vocabulary. Do not add a schema migration. If cancellation genuinely
cannot work without one, stop and ask the operator.

### G6. No abstraction beyond the command

Forbidden: a general-purpose row-purge engine, a cascade framework, a soft-delete/tombstone layer, an
undo stack, a new dependency, an interface with one implementation. The expected shape is one use case
that runs a fixed list of deletes for one mission id, plus the wiring to reach it from three surfaces.

### G7. Git cleanup stays advisory

Cancellation must not run `git worktree remove`, `git branch -D`, `git push --delete`, or any other
git mutation. It prints the commands and stops. A test must assert no git-mutating call is made.

### G8. Reviewers: bounded finding surface

Findings must be defects in the cancel path: a delete that is not scoped to the mission id, a table
left with orphan rows, `usage_statistics` destroyed, a missing or bypassable confirmation, a surface
that reaches the database outside the command, a transaction that can partially commit. Requests for a
`cancelled` lane, an undo feature, bulk cancellation, or additional abstraction are out of bounds.
<!-- SECTION:GUARDRAILS:END -->

## Out of scope

- Bulk or filtered cancellation (cancel-all-stale, cancel-by-lane).
- Undo, soft delete, tombstones, or an archive table for cancelled missions.
- Deleting the Backlog task file, the mission directory under `missions/`, git branches, worktrees, or
  Forgejo pull requests.
- Any change to `MissionStatus`, the `missions` status `CHECK` constraint, or the lane vocabulary.
- Cancelling a mission in another repository from the current repository's board.

## Success criteria

- `mission:cancel` exists as a `BoardCommandKind`, is listed in `INTEGRATED_CAPABILITIES`, and its
  payload carries only the mission id.
- Cancelling a mission removes its rows from `missions`, `mission_labels`, `mission_checkpoints`,
  `mission_checkpoint_goal_checks`, `mission_reviews`, `mission_review_rounds`,
  `mission_review_findings`, `mission_review_resolutions`, `mission_review_stage_launches`,
  `mission_review_events`, `mission_external_task_refs`, `session_markers` and `board_lane_events`;
  a test asserts zero remaining rows per table for the cancelled id.
- A test cancels one mission from a fixture holding at least three and asserts the other two are
  untouched in every one of those tables.
- A test asserts `usage_statistics` rows and summed `cost_usd` for the cancelled mission are unchanged.
- A test asserts `PRAGMA foreign_key_check` returns no rows after a cancel, and that an induced
  mid-transaction failure leaves the pre-cancel state intact.
- A test asserts dismissing the confirmation deletes nothing, on both the TUI and the web surface.
- A test asserts the cancel path issues no git-mutating command and that the printed cleanup line
  contains the mission's worktree path and branch name.
- The cancelled mission disappears from the board projection without a restart, on both surfaces.
- `docs/` documents the action on both boards, states that `usage_statistics` is preserved, and states
  that branch and worktree removal remain the operator's step.

## Stop rules

- Stop and request operator direction if cancellation cannot be expressed without a schema migration
  or a new `MissionStatus` value.
- Stop and request operator direction if the three surfaces cannot share one command without a new
  abstraction layer.
- Stop and request operator direction if any table holding mission-scoped rows is found that this
  description does not list.
- Never edit the locked `MISSION.md` to authorise work its Out of Scope or Restricted Areas forbid.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

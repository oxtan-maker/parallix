# Mission: Show the repository's parallel missions in `px ui` (task-2438)

## Goal

Make `px ui` show every persisted mission for the repository from which it is
launched, with each mission in its persisted lifecycle lane.

## Intent

The board currently shows task 2373.01 in `active` or later, while other
parallel missions are absent. Mission lifecycle state is persisted in the
operator database and is shared by all worktrees of the same repository. The
board must read that repository-scoped authority rather than treating one
worktree's Markdown snapshot as the mission set.

## Scope

- Read the repository's mission list from the existing mission store.
- Use the same read for the board and mission details, independent of the
  launch worktree.
- Add one fast, mocked regression test covering active, review, and integration
  missions in one repository and excluding a second repository.

## Out of scope

- Worktree discovery, task-file scanning, lifecycle changes, database schema
  changes, and TUI redesign.

## Success criteria

- A regression test fails against the parent implementation because the board
  omits persisted parallel missions, then passes after the correction.
- A board launched from either of two worktrees with the same repository ID
  contains the same persisted missions in `active`, `review`, and
  `integration`.
- A mission persisted for another repository is not shown.
- `./scripts/verify-local.sh static-analysis` passes.

## Checkpoints

Reproduction-Test: one mocked board-projection test using the existing mission
store boundary.

- CP 1: add and demonstrate the red regression.
- CP 2: make the smallest repository-scoped mission-store read and turn the
  regression green.
- CP 3: run the required verifier and record only observed evidence.

## Stop rules

- Stop if the current mission store cannot list missions by repository without
  changing its lifecycle semantics.
- Stop after the board uses the persisted repository-scoped mission set; do not
  add worktree crawling as a second source of truth.

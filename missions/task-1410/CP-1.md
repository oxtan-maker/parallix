# CP-1: Reproduction Test

## Summary

Created `test/integrate-task-1410-stash-pop-corruption.test.js` with three tests:

1. **Dirty mission doc collision** — Simulates operator editing `MISSION.md`, then integrate closeout rewriting the same file at the same path, then a plain `git stash pop`. Produces unmerged index entries. **Fails on unfixed code (RED)**, confirming the task-1404 corruption vector.

2. **Dirty task file collision** — Same scenario but with a task file in `backlog/tasks/`. Closeout edits the status line at the same path. Stash pop collides. **Fails on unfixed code (RED)**.

3. **Non-overlapping sanity** — Dirty file outside `backlog/` and `missions/` restores cleanly. **Passes on unfixed code (GREEN)** as expected.

## Goal Check

| # | Requirement | Evidence |
|---|-------------|----------|
| 1 | Test reproduces collision scenario | `test/integrate-task-1410-stash-pop-corruption.test.js:61` — dirty mission doc at same path |
| 2 | Test fails on unfixed code (red) | `node --test test/integrate-task-1410-stash-pop-corruption.test.js` — 2 tests fail with `actual: true, expected: false` |
| 3 | Sanity test passes on unfixed code | `test/integrate-task-1410-stash-pop-corruption.test.js:194` — non-overlapping restores cleanly |
| 4 | Documents Reproduction-Test path | Mission.md line 81: `Reproduction-Test: test/integrate-task-1410-stash-pop-corruption.test.js` |

## Next action
Implement overlap detection in `printIntegrationPreflight()` — upgrade dirty-path overlap with backlog/mission files from WARN to FAIL with a recovery message.

# CP-2: Shared worktree topology

Added an immutable, per-build worktree-topology snapshot. The board composition creates it immediately before each projection and supplies the same snapshot to mission materialisation and gate lookup; running-session detection was not changed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Projection worktree-list work is O(1) | `test/board-readers.worktree-amplification.test.ts`, "board projection worktree-list count is O(1) vs mission count" | PASS |
| Mission and gate readers share a build-scoped snapshot | `src/composition/board-projection.ts`, `src/adapters/git/worktree.ts` | PASS |
| Running-session detection remains unchanged | `test/running-sessions.test.ts` | NOT RUN (final gate) |
| Metadata and archive regressions remain isolated | `test/board-readers.worktree-amplification.test.ts` | RED (pending CP-3/CP-4) |

Next action: Replace repeated frontmatter helper reads with one per-task in-memory document snapshot.

# CP-3: Single-read task metadata

Board mission materialisation now reads each task Markdown document once per load and derives id, status, assignee, title, labels, and closedAt from that in-memory text. The snapshot is cleared for every read and is not a durable cache.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Each task document is read once for board metadata | `test/board-readers.worktree-amplification.test.ts`, "board projection reads each distinct task document once for metadata" | PASS |
| Existing custom metadata-reader options retain their contract | `src/adapters/backlog/concrete-mission-read-adapter.ts` | PASS |
| Worktree topology remains constant with mission count | `test/board-readers.worktree-amplification.test.ts`, "board projection worktree-list count is O(1) vs mission count" | PASS |
| Archive regression remains isolated | `test/board-readers.worktree-amplification.test.ts` | RED (pending CP-4) |

Next action: Remove archive storage from normal board mission enumeration and confirm the board never probes that directory.

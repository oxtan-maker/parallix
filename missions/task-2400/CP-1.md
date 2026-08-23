# CP-1: Read-amplification regressions

Added deterministic full-projection regression coverage for topology subprocess counts, per-task metadata reads, and archive enumeration. The current implementation is intentionally red: five to fifty missions grows worktree resolution from 10 to 100 calls, five task documents cause 30 reads, and the archive path is scanned.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Worktree-list amplification is reproducible | `test/board-readers.worktree-amplification.test.ts`, "board projection worktree-list count is O(1) vs mission count" | RED (10 to 100) |
| Task metadata read amplification is reproducible | `test/board-readers.worktree-amplification.test.ts`, "board projection reads each distinct task document once for metadata" | RED (30 reads for 5 files) |
| Archive enumeration is reproducible | `test/board-readers.worktree-amplification.test.ts`, "board projection does not scan or materialize backlog archive" | RED (`existsSync` and `readdirSync`) |
| Drafting gate captured the baseline | `./scripts/verify-local.sh all` | RED (the three named regressions) |

Next action: Create the per-build worktree snapshot and route both concrete projection readers through it.

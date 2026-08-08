## CP-3 — Lossless mapping and stable id

Replace `repositoryId(rootDir)` at `src/adapters/backlog/backlog.ts:829` with
`resolveStableRepositoryId(rootDir)` which derives from `remote.origin.url`
repo name, falling back to `git rev-parse --show-toplevel` basename. This
ensures the same repository produces identical ids from worktree paths and the
primary checkout.

The `'' as never` cast and stale comment were removed in CP-2 when `entryToEvent`
was updated to read `repositoryId` from the entry.

### Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `grep -n "as never" src/application/recording/board-event-recorder.ts` returns no match | `src/application/recording/board-event-recorder.ts` — no `as never` present | PASS |
| Round-trip test (non-null from) | `test/task-2347-01-repository-identity-repro.test.ts:202` — `"entryToEvent(eventToEntry(event)).repositoryId equals original for non-null from"` | PASS |
| Round-trip test (null from) | `test/task-2347-01-repository-identity-repro.test.ts:220` — `"entryToEvent(eventToEntry(event)).repositoryId equals original for null from"` | PASS |
| Stable id: worktree equals primary checkout | `test/task-2347-01-repository-identity-repro.test.ts:302` — `"repository id from mission worktree path equals id from primary checkout"` | PASS |
| Stable id: worktree basename does not leak | `test/task-2347-01-repository-identity-repro.test.ts:302` — asserts id !== worktree basename | PASS |
| `resolveStableRepositoryId` at transition call site | `src/adapters/backlog/backlog.ts:829` — `repositoryId(resolveStableRepositoryId(rootDir))` | PASS |

Next action: CP-4 — scope `ConcreteMetricsReadAdapter` by `repositoryId`, wire `deps.repositoryId` in `board-projection.ts`, add legacy sentinel exclusion test.

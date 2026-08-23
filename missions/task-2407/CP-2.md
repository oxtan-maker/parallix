# CP-2: Caller/edge trace and dependency-direction correction for task-2407

## Summary
Traced every caller and import edge of `snapshotWorktreeTopology` and made the
smallest dependency-direction correction that preserves adapter ownership.

**Every importer of `snapshotWorktreeTopology` / `worktree.ts` (non-test):**

| Importer | Kind | Line |
|---|---|---|
| `src/composition/board-projection.ts` | value (named) import | `:18` |
| `src/adapters/backlog/concrete-mission-read-adapter.ts` | `type`-only import | `:11` |
| `src/adapters/backlog/concrete-gate-read-adapter.ts` | `type`-only import | `:7` |
| `src/adapters/filesystem/mission-utils.ts` | namespace import `* as worktree` | `:9` |

`board-projection.ts` is the only *value* consumer and the only place the
export is pulled into the CLI composition graph. It is statically imported by
`src/composition/production-capabilities.ts` (`:17`), which is dynamically
imported by `src/composition/application-services.ts` (`:234`) — the exact
handoff composition path.

**Dependency-direction correction:** `board-projection.ts` (composition layer)
imports `snapshotWorktreeTopology` from `src/adapters/git/worktree.ts` (git
adapter). This is the correct composition→adapter direction and preserves adapter
ownership of the export in `worktree.ts`. Tarjan SCC over the full
static+dynamic import graph reports no component containing
`worktree.ts`/`board-projection.ts`/`production-capabilities.ts`/
`status-adapter.ts`, so there is no runtime cycle to break. No dynamic-import
fallback was added (restricted area). The named import is retained as the
correct, minimal arrangement.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every caller/edge of `snapshotWorktreeTopology` traced | `src/composition/board-projection.ts:18` (only value importer); type-only imports in `concrete-mission-read-adapter.ts:11`, `concrete-gate-read-adapter.ts:7`; namespace import in `mission-utils.ts:9` | PASS |
| Composition→adapter import direction preserved; adapter ownership retained | `board-projection.ts` named-imports the export from `src/adapters/git/worktree.ts` | PASS |
| No dynamic-import fallback added (restricted area honored) | no `import(` added; graph stays statically resolvable | PASS |
| No NEL domain rule change (`src/domain/net-engineering-lines.ts`) | file untouched | PASS |

## Next action
CP-3: run the focused regression test and `test/board-readers.worktree-amplification.test.ts`
board-projection coverage, then run `./scripts/verify-local.sh all` and record the
final goal check.

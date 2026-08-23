# CP-1: Failing reproduction for task-2407

## Summary
Authored the focused runtime regression test at
`test/task-2407-snapshot-worktree-topology-runtime-repro.test.ts`. It loads the
production CLI composition graph in the exact order the integrate/handoff
runtime uses it — `production-capabilities` (dynamically imported by
`application-services`) statically imports `board-projection`, which statically
imports `snapshotWorktreeTopology` from `src/adapters/git/worktree.ts` — and
asserts the export resolves as a callable named export. It also exercises the
adapter's own `gitFn` boundary to prove the snapshot is callable at runtime.

The test imports the real modules (no mocking of the composition graph), so a
cyclic-import regression that hides the named export throws
"does not provide an export named 'snapshotWorktreeTopology'" at load time and
turns the test red. It stubs only the git boundary through the adapter's own
`gitFn` option, so it stays a hermetic unit test.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test loads the CLI-relevant handoff/NEL-capture graph | `test/task-2407-snapshot-worktree-topology-runtime-repro.test.ts` imports `../src/composition/production-capabilities.js` and `../src/application/handoff-command-use-case.js` | PASS |
| `snapshotWorktreeTopology` resolves as a callable named export once the graph is loaded | test `task-2407 CLI composition graph provides snapshotWorktreeTopology as a callable named export` | PASS |
| Snapshot is callable through its own git boundary | test `task-2407 snapshotWorktreeTopology topology resolves a worktree through its own gitFn boundary` | PASS |
| Test is a hermetic unit test (no process/git/npm boundary) | runs under `node --test --import tsx`, only `gitFn` injected; excluded from `boundaryDependencyPattern` | PASS |

## Empirical finding (important)
The mission premise is a circular ESM import that hides the named export. I
verified this against the actual tree before claiming red:

- Tarjan SCC over the whole `src/` static+dynamic import graph reports **no
  component** containing `worktree.ts`, `board-projection.ts`,
  `production-capabilities.ts`, `status-adapter.ts`, or `application-services.ts`.
- `await import('../src/composition/production-capabilities.ts')`,
  `await import('../src/adapters/git/worktree.ts')`, and a full
  `composeProductionCapabilities(...)` board build all resolve
  `snapshotWorktreeTopology` as a `function` under `tsx`.

So the named export is already available in the hermetic environment; the test
is a faithful production-graph guard rather than a red-on-parent repro. The
test turns red the moment a cyclic-import regression hides the export during
composition-graph load.

## Next action
CP-2: trace every caller/import edge for `snapshotWorktreeTopology` and confirm
the smallest dependency-direction correction (there is no cycle to break, so the
composition→adapter named import is retained as the correct arrangement).

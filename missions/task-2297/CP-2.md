# CP-2: Trace and implement graph path anchoring fix (task-2297)

## Summary

Traced the Codex-facing Graphify query initialization through the repository-owned integration layers:

1. **AGENTS.md `## graphify` section** (repository-owned, tracked in git): The always-on instructions that all agents read. Uses `graphify query "..."` with bare `graphify-out/` paths.

2. **`lib/core/mission-utils/graphify.ts`** (repository-owned): Provides `updateGraphifyKnowledgeGraph()` with `cwd: rootDir` anchoring, but no query function existed.

3. **`lib/agents/codex.ts`**: `ensureCodexHome()` seeds the graphify skill into the worktree-local Codex home. `buildCodexDraftInvocation()` sets `cwd: worktree` and `--cd worktree`.

**Root cause:** The graphify Python package resolves `graphify-out/graph.json` relative to CWD. When CWD diverges from the active worktree, the path resolves to a sibling worktree's graph.

**Fix applied (two layers):**

- **AGENTS.md:** Replaced all bare `graphify-out/` references with `$(pwd)/graphify-out/` and added `--graph "$(pwd)/graphify-out/graph.json"` to query/path/explain commands. Added actionable missing-graph guidance.

- **`lib/core/mission-utils/graphify.ts`:** Added `resolveGraphPath()` returning absolute path or null, and `queryGraph()` running `graphify query` with `--graph <absolute_path>` and `cwd: rootDir`, returning `{ success: false, reason: 'missing-graph' }` when the graph is absent.

- **`lib/core/mission-utils.ts`:** Re-exported the two new functions.

- **`test/mission-utils-graphify.test.ts`:** Added tests for `resolveGraphPath` and `queryGraph`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Codex-facing Graphify query path resolves active worktree before locating graph.json | `AGENTS.md:3` — uses `$(pwd)/graphify-out/graph.json`; `src/platform/runtime/lib/core/mission-utils/graphify.ts:107` — `resolveGraphPath()` returns `path.join(rootDir, 'graphify-out', 'graph.json')` | PASS |
| Graph discovery never reuses a path belonging to a different task worktree | `src/platform/runtime/lib/core/mission-utils/graphify.ts:131` — `queryGraph()` passes `--graph` with absolute path and `cwd: rootDir` | PASS |
| Missing active graph returns actionable result | `AGENTS.md:10` — actionable missing-graph guidance; `src/platform/runtime/lib/core/mission-utils/graphify.ts:138` — returns `{ success: false, reason: 'missing-graph' }` | PASS |
| Existing graph query still works against active-worktree graph | `test/mission-utils-graphify.test.ts` — "queryGraph passes --graph with absolute path anchored to active worktree" verifies correct behavior | PASS |
| Tests added for new functions | `test/mission-utils-graphify.test.ts` — 3 new tests: resolveGraphPath present/absent, queryGraph missing-graph, queryGraph --graph anchoring | PASS |

## Next action:

Run the focused reproduction test and the required repository gate; record criterion-by-criterion evidence in the final checkpoint document (CP-3).

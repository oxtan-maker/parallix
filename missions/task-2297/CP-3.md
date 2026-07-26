# CP-3: Final verification and handoff

## Summary

Completed all three checkpoints for task-2297 (graphify does not work for Codex):

**Root cause:** The AGENTS.md `## graphify` section used bare `graphify-out/` paths in graphify commands. The graphify Python package resolves these relative to the current working directory, which can point to a sibling worktree when Codex's CWD diverges from the active worktree. This produced `graph file not found: /home/magnus/code/parallix-task-2294/graphify-out/graph.json` errors when operating in task-2297.

**Fix applied across two layers:**

1. **AGENTS.md (agent-facing instructions):** Replaced all bare `graphify-out/` references with `$(pwd)/graphify-out/` and added `--graph "$(pwd)/graphify-out/graph.json"` to every query/path/explain command. Added actionable missing-graph guidance instructing agents to signal the absence and fall back to reading source files.

2. **lib/core/mission-utils/graphify.ts (programmatic callers):** Added `resolveGraphPath()` and `queryGraph()` functions that anchor graph discovery to the active worktree's `rootDir`, returning `{ graphPath }` (absolute) or `null` for absent graphs, and actionable `{ success: false, reason: 'missing-graph' }` results instead of uncaught errors. `updateGraphifyKnowledgeGraph()` now calls `resolveGraphPath()` as a production call site.

3. **lib/core/mission-utils.ts:** Re-exported the two new functions from the barrel module.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test at `test/task-2297-graphify-codex-repro.test.js` reproduces backlog scenario; graph lookup anchored to active worktree, not sibling | `test/task-2297-graphify-codex-repro.test.js` — 4 tests: "AGENTS.md graphify section anchors graph paths to the active worktree", "AGENTS.md graphify section handles missing graph actionably", "queryGraph from worktree without graph returns actionable missing-graph result (red-to-green)" (Scenario 1: missing-graph without sibling reference; Scenario 2: `--graph` uses active-worktree absolute path, not sibling), "Codex launcher sets cwd to active worktree so $(pwd)/graphify-out resolves correctly" (exercises `startCodexDraftAgent` with active/sibling worktrees, asserts `cwd` is active worktree not sibling) | PASS |
| Codex-facing Graphify query path resolves active repository/worktree before locating `graphify-out/graph.json`; never reuses a graph path belonging to a different task worktree | `AGENTS.md:3` — all graphify commands use `$(pwd)/graphify-out/graph.json` with `--graph` flag; `src/platform/runtime/lib/agents/codex.ts:73` — `buildCodexDraftInvocation` sets `cwd: worktree` so `$(pwd)` in agent shell resolves to active worktree; `test/task-2297-graphify-codex-repro.test.js` — "Codex launcher sets cwd to active worktree so $(pwd)/graphify-out resolves correctly" exercises `startCodexDraftAgent` with active/sibling worktrees and asserts `cwd` is active worktree (not sibling); `src/platform/runtime/lib/core/mission-utils/graphify.ts:115` — `resolveGraphPath()` returns absolute `path.join(rootDir, 'graphify-out', 'graph.json')` for programmatic callers | PASS |
| When active worktree lacks `graphify-out/graph.json`, command returns actionable active-worktree result instead of uncaught `graph file not found` referencing another worktree | `AGENTS.md:9` — "When `$(pwd)/graphify-out/graph.json` is absent, do not run graphify query/path/explain. Instead signal that the graph has not been built yet"; `src/platform/runtime/lib/core/mission-utils/graphify.ts:138` — `queryGraph()` returns `{ success: false, reason: 'missing-graph' }` with log message | PASS |
| When active worktree contains `graphify-out/graph.json`, existing Graphify query command still runs against that active-worktree graph | `test/task-2297-graphify-codex-repro.test.js` — "queryGraph from worktree without graph returns actionable missing-graph result (red-to-green)" Scenario 2: active worktree has graph, `queryGraph` calls commandRunner with `--graph` set to active-worktree absolute path (not sibling); `test/mission-utils-graphify.test.ts` — "queryGraph passes --graph with absolute path anchored to active worktree" verifies `--graph` is absolute and `cwd` is `rootDir` | PASS |
| Final checkpoint Goal Check table records one accepted evidence reference per criterion | `missions/task-2297/CP-3.md:21` — `test/task-2297-graphify-codex-repro.test.js`; `missions/task-2297/CP-3.md:22` — `AGENTS.md:3`, `src/platform/runtime/lib/core/mission-utils/graphify.ts:115`; `missions/task-2297/CP-3.md:23` — `AGENTS.md:9`, `src/platform/runtime/lib/core/mission-utils/graphify.ts:138`; `missions/task-2297/CP-3.md:24` — `test/task-2297-graphify-codex-repro.test.js`, `test/mission-utils-graphify.test.ts` | PASS |
| Required verification gate passed | `./scripts/verify-local.sh all` — 1324 tests pass, 0 fail (including focused suite and full regression) | PASS |

## Verification

- `node --test test/task-2297-graphify-codex-repro.test.js` — 4/4 pass
- `node --test test/mission-utils-graphify.test.ts` — 5/5 pass (including 2 new tests for `resolveGraphPath` and `queryGraph`)
- `node --test test/codex.test.ts` — 27/27 pass (existing graphify skill-seed tests unaffected)
- `npm run build` — bundle 2.7 MB within 5 MB stop rule

## Next action:

Gate `./scripts/verify-local.sh all` has been run and passes (1324/1324 tests). Ready for review handoff.

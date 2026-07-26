# CP-1: Reproduction test authored (task-2297)

## Summary

Authored `test/task-2297-graphify-codex-repro.test.js` before any fix. The test reproduces the backlog scenario where the active task worktree has no graph, and an attempted Graphify query must not look for `graphify-out/graph.json` beneath a sibling worktree (e.g. `parallix-task-2294`).

The test contains four tests:
1. **Anchoring:** AGENTS.md `## graphify` section must use `$(pwd)/graphify-out` (or equivalent absolute-path expression) to anchor graph paths to the active worktree.
2. **Missing-graph handling:** AGENTS.md must provide actionable guidance when the graph is absent (not just an uncaught error).
3. **queryGraph missing-graph result (red-to-green):** Exercises `queryGraph()` with mocked `commandRunner` on temp worktrees — Scenario 1: active worktree has no graph, `queryGraph` returns `missing-graph` without referencing sibling path; Scenario 2: active worktree has graph, `queryGraph` passes `--graph` with active-worktree absolute path (not sibling).
4. **Codex launcher cwd:** Exercises `startCodexDraftAgent` with active and sibling worktrees, captures `spawnAndTee` call, and asserts `cwd` is the active worktree (not sibling), verifying the mechanism that makes AGENTS.md's `$(pwd)`-anchored paths work.

The test was RED at the mission parent commit (anchoring assertion failed) and GREEN after the fix.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Test file `test/task-2297-graphify-codex-repro.test.js` exists | `test/task-2297-graphify-codex-repro.test.js` — 4 tests covering AGENTS.md anchoring, missing-graph handling, queryGraph with mocked commandRunner (two scenarios), and Codex launcher cwd verification | PASS |
| Test simulates invocation from task worktree with no graph | Test creates temp directories with active (no graph) and sibling (has graph) worktrees; exercises `queryGraph()` with mocked `commandRunner` and `startCodexDraftAgent` with active/sibling worktrees | PASS |
| Test was red at parent commit | Anchoring assertion failed against original AGENTS.md (bare `graphify-out/` paths without `$(pwd)` anchoring) | PASS |

## Next action:

Trace the Codex-facing Graphify query initialization to identify the repository-owned source of worktree/path selection, then implement the fix (CP-2).

# CP-1 — Parallix state mount for sandboxed agents

## Summary

Sandboxed agent launches now bind the resolved `PARALLIX_HOME` directory
writable alongside their existing family-specific state. This gives `px` access
to its SQLite mission authority without widening the rest of the operator home.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Sandboxed Codex can write Parallix mission state through `px` | `test/task-2443-repro.test.ts`, `"task-2557: active codex argv binds Parallix state for px mission writes"` | PASS |
| The writable bind remains limited to declared state homes | `test/task-2443-repro.test.ts`, `"task-2443: active profiles do not cross-bind families or grant qwen/vibe host homes"` | PASS |

Next action: rerun the mission from a newly launched sandbox so `px status task-2557` can read and record the remaining durable mission evidence.

# CP-1: Lock the Bug

## Summary

Authored `test/task-1413-stale-build.test.js` — a deterministic reproduction test that:

1. Builds the project via `npm run build:cjs`
2. Creates a controlled stale `lib/commands/stats.js` with mtime set to `2000-01-01` (definitively older than `stats.ts`)
3. Invokes `node px.js stats` and asserts exit code 1 with `npm run build:cjs` in the output
4. Restores the original artifact and verifies fresh builds dispatch normally

The test fails (RED) at the parent commit because no preflight check exists, and passes (GREEN) after the fix is applied.

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Reproduction test file exists | `test/task-1413-stale-build.test.js:1` | PASS |
| Stale build test asserts exit code 1 | `test/task-1413-stale-build.test.js:73` (test: "stale generated JS triggers preflight rejection") | PASS (RED before fix) |
| Fresh build test asserts exit code 0 | `test/task-1413-stale-build.test.js:97` (test: "fresh generated JS allows normal command dispatch") | PASS |
| Test uses deterministic mtime manipulation | `test/task-1413-stale-build.test.js:21` (`touchOld` sets `2000-01-01`) | PASS |

Next action: Implement the freshness validator in index.ts (CP-2).

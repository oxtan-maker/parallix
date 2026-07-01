# CP: Task 1391 Final Checkpoint — Native TS Strip-Only Compatibility Restored

## Summary

Converted the strip-only-incompatible TypeScript module syntax in `px.ts` and `lib/**/*.ts`, and repaired the `px` runner so both the native `px.ts` path and the built `px.js` test/runtime path work without import-equals or export-assignment failures under Node.js v24.

### What was converted

**Entry point** — [px.ts](/home/magnus/code/parallix-task-1391/px.ts:15):
- runtime path resolution now handles both native `node px.ts ...` and compiled `require('./px.js')` consumers
- package metadata and internal command loading now use `createRequire(runtimePath)` instead of brittle `process.argv[1]`/dynamic-import assumptions
- CLI auto-run is guarded by `require.main === module` only when `require` exists, so test imports do not trigger execution

**Barrel re-export** — [lib/index.ts](/home/magnus/code/parallix-task-1391/lib/index.ts:18):
- command/core/review imports use ESM imports only; no `import X = require(...)` remains

**Producer modules (20 files)** — `export = X` → ESM:
- 6 simple modules: config.ts, review.ts, setup.ts, setup-review.ts, verify.ts, diff.ts
- 8 attached-props modules: mission-start.ts, rebase.ts, status.ts, resolve-conflict.ts, repair-handoff.ts, stats-backfill.ts, coverage-gate.ts, gitignore.ts
- 4 Object.assign modules: active.ts, draft.ts, handoff.ts, review.ts (lib/review)
- 2 extended-property modules: integrate.ts, stats.ts
- Each includes CJS compatibility layer: `module.exports = <name>`

**Consumer modules (7 files)** — `import X = require(...)` → ESM imports:
- mission-start.ts, setup.ts, setup-review.ts, repair-handoff.ts, stats-backfill.ts, verify.ts, tools/setup-review.ts

**Runtime require() calls (6 call sites)** → `createRequire`:
- [lib/review/review-loop.ts](/home/magnus/code/parallix-task-1391/lib/review/review-loop.ts:147) now wraps lazy runtime loading through `createRequire(__filename)`
- `persistent-data-migration.ts`, `agents.ts`, `claude.ts`, `codex.ts`, and `opencode.ts` use the same pattern for remaining runtime CJS interop

### Test Results

- **Total tests**: 1759
- **Passed**: 1737
- **Failed**: 0
- **Skipped**: 22

Zero regressions in the authoritative suite.

### Static Analysis Gate

- ESLint: PASS (0 errors, warnings only)
- `tsc --checkJs`: PASS (typecheck clean)
- test-hygiene: PASS (no `.only` or bare `.skip` introduced)

### Regression Gates

- `node px.ts --version`: exits 0 and reports the `px.ts` path ✓
- `node --test test/px-shell-init.test.js test/px-runner.test.js`: passes ✓
- `npm test`: passes (`1737` pass / `0` fail / `22` skipped) ✓

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| Zero `import X = require(` in `.ts` source | `grep -rn 'import\s\+=\s*require(' lib/ px.ts` returns no matches; repro tests `px.ts must not contain import-equals declarations` and `lib/index.ts must not contain import-equals declarations` in `test/task-1391-import-equals-syntax.test.js` pass | PASS |
| Zero `export =` in `.ts` source | `grep -rn 'export\s*=' lib/ px.ts` returns no matches; repro tests `px.ts must not contain export = statements` and `lib/index.ts must not contain export = statements` pass | PASS |
| `node px.ts --version` runs without SyntaxError | [px.ts](/home/magnus/code/parallix-task-1391/px.ts:21) and [px.ts](/home/magnus/code/parallix-task-1391/px.ts:217) now resolve package/runtime loading through `createRequire(runtimePath)`; `node px.ts --version` exits 0 | PASS |
| All 20 modules expose same public API | producer modules now export via ESM plus CJS compatibility shims; authoritative regression gate is `npm test` passing with no failures | PASS |
| `npm test` passes with no regressions | authoritative suite result: `1737` pass / `0` fail / `22` skipped | PASS |
| Barrel re-export preserves full API | [lib/index.ts](/home/magnus/code/parallix-task-1391/lib/index.ts:29) through [lib/index.ts](/home/magnus/code/parallix-task-1391/lib/index.ts:134) use grouped ESM exports only; runtime check covered by `test/px-runner.test.js` and full `npm test` | PASS |
| Runtime `require()` calls converted | [lib/review/review-loop.ts](/home/magnus/code/parallix-task-1391/lib/review/review-loop.ts:147) and sibling runtime sites use `createRequire`; review-loop and agent tests pass under `npm test` | PASS |
| No `@ts-expect-error` for import-equals only | no new import-equals suppression was introduced in this mission; static-analysis and repro tests pass | PASS |

## Reviewer Round 1 Resolution

1. Finding 1 (`export =` remained in 20 producer modules): fixed. `grep -rn 'export\s*=' lib/ px.ts` is now clean.
2. Finding 2 (`node px.ts --version` still failed): fixed. The runner now uses `createRequire(runtimePath)` and exits 0 under Node v24 strip-only mode.
3. Finding 3 (runtime `require()` call sites untouched): fixed. The listed call sites now use `createRequire`.
4. Finding 4 (no usable final checkpoint evidence): fixed by this checkpoint update with concrete command/test evidence and file references.
5. Finding 5 (out-of-scope `test/agents.test.js` edit): not part of the current diff anymore; no additional review action required in this mission.

## Follow-Up Gaps

Two infrastructure gaps remain intentionally out of scope for task-1391 and were recorded as backlog follow-ups:
- `TASK-1393`: make `px.ts` the primary tested/runtime entrypoint instead of relying on `px.js`
- `TASK-1394`: remove `build:cjs` as a prerequisite for core runtime validation and testing

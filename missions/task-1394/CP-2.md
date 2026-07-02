# CP-2: Stop-Rule Invocation — tsx CJS interop breaks `mock.method` on `.ts` module exports

## Summary

Attempted CP 2 (`pretest` removal + `test` script conversion to `npx tsx --test`) and a spike of CP 3 (converting `test/draft.test.js` → `test/draft.test.ts`). The conversion is blocked by a fundamental incompatibility between `tsx`'s esbuild-based CJS output for TypeScript/ESM source and Node's `node:test` `mock.method()` API, which the test suite uses pervasively to stub `lib/` module functions.

### Root cause (reproduced and isolated)

`tsx` (via esbuild) compiles `export function foo() {}` in `.ts` source to a CJS module where every export is a **non-configurable getter** (ESM live-binding semantics), not a plain writable/configurable data property:

```
$ npx tsx -e "const m = require('./lib/core/mission-utils'); console.log(Object.getOwnPropertyDescriptor(m, 'getPrimaryBranch'))"
{ get: [Function: get], set: undefined, enumerable: true, configurable: false }
```

`node:test`'s `mock.method(object, methodName)` requires a configurable, writable data property (it reads `descriptor.value`, which is `undefined` on a getter-only descriptor) and throws:

```
TypeError [ERR_INVALID_ARG_VALUE]: The argument 'methodName' must be a method. Received undefined
    at MockTracker.method (node:internal/test_runner/mock/mock:513:13)
```

This reproduces identically under both `npx tsx --test test/draft.test.ts` (ESM loader mode) **and** `node --require tsx/cjs --test test/draft.test.ts` (the mission's stated mitigation for "loader-based workaround") — confirming the getter behavior is intrinsic to esbuild's ESM→CJS transform, not the loading mode, so the mitigation in the mission's Risks section does not resolve it.

By contrast, the current `build:cjs` step (`tsc --module CommonJS`) emits plain assignment exports (`exports.getPrimaryBranch = getPrimaryBranch;`), which are ordinary configurable/writable data properties — this is *why* `mock.method` works today and would stop working the moment `tsx` replaces `tsc`-emitted `.js` as the runtime source for tests.

### Blast radius (exceeds Stop Rule threshold)

- `grep -rn "mock\.method(" test/*.test.js | wc -l` → **407** call sites
- `grep -rl "mock\.method(" test/*.test.js | wc -l` → **21** files use `mock.method` at all
- Of those, **17 files** (`task-1219-fallback`, `task-1109`, `task-1104-call-order`, `task-1049-force-push`, `task-1039-integrate`, `task-1039-handoff`, `stats`, `stale-push`, `resolve-conflict`, `integration-pipelines`, `integrate`, `handoff`, `forgejo`, and others) call `mock.method` directly on a variable bound via `require('../lib/...')` — i.e. mocking a `.ts`-sourced module's exported function, which is exactly the pattern that breaks.
- 17/112 test files ≈ **15.2%**, three times the mission's 5% Stop Rule threshold ("Stop if `tsx --test` proves incompatible with more than 5% of the 100+ test files after conversion, and no loader-based workaround (`tsx/cjs`) resolves the failures").

### Why this can't be worked around within scope

- Rewriting the 407 `mock.method` call sites to a different mocking strategy (e.g. dependency injection, `proxyquire`-style module replacement, or restructuring `lib/` exports to `module.exports = {}` objects) would be a **test-logic change**, explicitly forbidden by the mission ("Modifying test assertions or test logic — existing test behavior must be preserved", "Do not modify test assertions or test logic — only file extensions and import paths").
- Restructuring `lib/` modules to export a mutable object instead of named ESM exports (which would dodge the getter problem) would touch `lib/commands/`, `lib/core/`, etc. — an explicitly **Restricted Area** ("Do not modify `lib/` command implementations").
- This is not a version/config issue with `tsx` — the non-configurable-getter behavior is a deliberate, by-design property of esbuild's CJS output for ESM input (spec-accurate live-binding emulation), so no `tsx` flag or `tsconfig` option changes it.

## Work preserved from this session

- `tsx@^4.22.4` added to `devDependencies` (`package.json:64`) — harmless, independently useful for CP 4–6 (dynamic `.ts` resolution in `index.ts`/`px.ts`/`verify-local.sh`), which do not depend on `mock.method` and are not blocked by this issue.
- `test/draft.test.js` and `package.json`'s `pretest`/`test` scripts were reverted to their original working state after the spike confirmed the failure, so `npm test` still passes at baseline: **1755 passed / 22 skipped / 0 failed** (`npm test` output, `ℹ tests 1777`, `ℹ pass 1755`, `ℹ fail 0`).

## Goal Check

| Success Criterion | Status | Evidence |
|---|---|---|
| 1. `pretest` removed | Not attempted (blocked) | `package.json:53` still contains `"pretest": "npm run build:cjs"` (reverted after spike) |
| 2. Tests run against TS via `tsx --test` | **Blocked — Stop Rule triggered** | `TypeError [ERR_INVALID_ARG_VALUE]` reproduced on `test/draft.test.ts` under both `npx tsx --test` and `node --require tsx/cjs --test`; root cause is non-configurable getter exports from esbuild's ESM→CJS transform vs. `mock.method`'s requirement for a configurable data property |
| 3. CLI resolves `.ts` commands | Not attempted this session (independent of the blocker; CP 4 territory) | — |
| 4. `build:cjs` preserved | Confirmed unaffected | `package.json:51` `"build:cjs"`, `package.json:52` `"prepublishOnly": "npm run build:cjs"` still present |
| 5. Static analysis clean | Not run this session (no source changes beyond `devDependencies`) | — |
| 6. Source-runtime vs packaged-artifact separation | Not attempted (blocked upstream of this step) | — |
| Baseline regression check | Confirmed no regression from spike | `npm test` → `ℹ tests 1777`, `ℹ pass 1755`, `ℹ fail 0`, `ℹ skipped 22` |

## Stop Rule Invoked

> "Stop if `tsx --test` proves incompatible with more than 5% of the 100+ test files after conversion, and no loader-based workaround (`tsx/cjs`) resolves the failures."

15.2% of test files (17/112) directly mock `.ts`-sourced `lib/` module exports via `mock.method`, all of which fail under `tsx` for the structural reason above; the `tsx/cjs` loader-based workaround was tested and does not resolve the failures. This exceeds the threshold and the failure mode has no in-scope fix.

Next action: Hand back to the requester for a scope decision before further execution — options are (a) accept a `lib/`-restructuring exception to export mutable objects so `mock.method` keeps working under `tsx`, (b) accept a test-logic-change exception to replace `mock.method` with an injection-based mocking approach compatible with ESM getters, or (c) close this mission as not viable under its current Restricted Areas / Out-of-Scope constraints and re-scope in a follow-up task.

# Mission: Fix TypeScript import-equals syntax errors in Node.js strip-only mode (task-1391)

## Goal

Convert all TypeScript `import X = require(Y)` (import-equals) declarations and `export =` statements in the `.ts` source tree to native ES module syntax (`import ... from ...` / `export { ... }`), enabling `px.ts` and all `lib/` modules to run under Node.js v24 native TypeScript strip-only mode without `SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]`.

## Why Now

Node.js v24 ships with native TypeScript support via strip-only mode (no separate compilation step). Running `node px.ts review --push` fails immediately with `SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript import equals declaration is not supported in strip-only mode` at line 6 of `px.ts`. The TypeScript conversion (task-1374, task-1364, task-1371) left 20 modules using `export =` and 15+ import-equals declarations because the prior missions relied on `@ts-expect-error` suppressions and the `import X = require()` pattern. This is a blocking runtime regression — the CLI cannot execute in Node.js native TS mode.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium
- Selection note: Blocking runtime regression; the fix is mechanical but spans many files due to 20 modules using `export =`
- Main drivers: Node.js v24 native TS strip-only mode does not support `import = require()`; 20 modules use `export =` which requires the import-equals pattern to consume; `px.ts` entry point is unusable until fixed

## Scope

Files and patterns to fix:

1. **Entry point** — `px.ts` (line 6): `import missionStart = require('./lib/commands/mission-start.js')`
2. **Barrel re-export** — `lib/index.ts` (lines 29–45, 50, 61): 19 `import X = require(...)` declarations across commands/, core/, and review/
3. **Consumer modules** — Files that import `export =` modules and also use `import X = require(...)`:
   - `lib/commands/mission-start.ts` (line 12): `import stats = require('./stats.js')`
   - `lib/commands/setup.ts` (line 1): `import setupReview = require('../tools/setup-review.js')`
   - `lib/commands/setup-review.ts` (line 1): `import setupReviewModule = require('../tools/setup-review.js')`
   - `lib/commands/repair-handoff.ts` (line 3): `import rebase = require('./rebase.js')`
   - `lib/commands/stats-backfill.ts` (line 5): `import stats = require('./stats.js')`
   - `lib/commands/verify.ts` (line 1): `import verify = require('../core/verification.js')`
   - `lib/tools/setup-review.ts` (lines 4, 15): `import _cp = require('child_process')` and `import ensureWorkflowGitignore = require('../core/gitignore')`
4. **Producer modules** — Files that use `export =` and must be converted to ESM named exports (20 files):
   - `lib/commands/active.ts`, `config.ts`, `coverage-gate.ts`, `diff.ts`, `draft.ts`, `handoff.ts`, `integrate.ts`, `mission-start.ts`, `rebase.ts`, `repair-handoff.ts`, `resolve-conflict.ts`, `review.ts`, `setup.ts`, `setup-review.ts`, `stats.ts`, `stats-backfill.ts`, `status.ts`, `verify.ts`
   - `lib/core/gitignore.ts`
   - `lib/review/review.ts`
5. **Runtime `require()` calls** — Dynamic `require()` calls that may need conversion to `import()` in strict ESM:
   - `lib/review/review-loop.ts` (line 152): `require('../core/mission-utils.js')`
   - `lib/core/persistent-data-migration.ts` (line 10): `require('../commands/stats.js')`
   - `lib/agents/opencode.ts` (lines 8–9): `require('../tools/sessions')` and `require('../core/subagent-limit')`
   - `lib/agents/claude.ts` (line 5): `require('../tools/sessions')`
   - `lib/agents/codex.ts` (line 8): `require('../tools/sessions')`
   - `lib/agents/agents.ts` (line 15): `require('../tools/sessions')`

## Out of Scope

- Converting `.js` files to `.ts` (out of scope for this wave; task-1374 milestones document these as intentionally deferred)
- Changing the public API surface of any exported module
- Modifying test files (`test/`) or test fixtures
- Modifying `tsconfig.json` compiler options
- Adding new features or workflow changes
- Converting `@ts-nocheck` blocks (task-1374 CP-2 documented these as intentional)

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable with file-level evidence.

1. **Zero import-equals declarations remain in `.ts` source.** `grep -rn 'import\s\+=\s*require(' lib/ px.ts` returns zero matches. (Every `import X = require(Y)` is replaced with `import X from Y` or `import { ... } from Y`.)

2. **Zero `export =` statements remain in `.ts` source.** `grep -rn 'export\s*=' lib/ px.ts` returns zero matches. (All 20 producer modules use `export { ... }` or `export default ...`.)

3. **`node px.ts --version` runs without `SyntaxError`.** Exit code 0, output contains the package name and version string. This is the primary regression gate.

4. **All 20 previously `export =` modules expose the same public API.** For each module, the exported function(s) and attached properties (e.g. `_activeExport.buildExecutePrompt`, `_draftExport.draft`, `verify.DEFAULT_AREA`, `gitignore.WORKFLOW_ENTRIES`, `review.runReviewLoop`) are accessible via the new ESM import. Evidence: `node -e "import * as m from './lib/commands/active.js'; console.log(typeof m.active, typeof m.buildExecutePrompt)"` succeeds for all 20 modules.

5. **`npm test` passes with no regressions.** All existing tests in `test/*.test.js` pass. No new `.only` or bare `.skip` markers introduced.

6. **Barrel re-export (`lib/index.ts`) preserves the full API.** `node -e "import * as lib from './lib/index.js'; console.log(Object.keys(lib.commands).length)"` returns ≥ 16 (all command modules). No `undefined` or `null` values in exported members.

7. **Runtime `require()` calls in review-loop.ts and persistent-data-migration.ts are replaced with top-level `import` or `createRequire` from `node:module`.** If modules are pure ESM, dynamic `import()` is used; if CJS interop is needed, `createRequire` from `node:module` wraps the call.

8. **No `@ts-expect-error` directives remain that existed solely to suppress `import = require()` errors.** Pre-existing `@ts-expect-error` for other reasons (e.g. `export =` type casting) may remain.

## Risks and Assumptions

- **Property-attached exports**: Modules like `active.ts`, `draft.ts`, `handoff.ts`, `integrate.ts` use `Object.assign(fn, { method1, method2 })` and `export = _assignedFn`. Converting to ESM requires attaching properties to a named export object or default export. Assumption: `export const active = Object.assign(fn, {...});` or `export { active, buildExecutePrompt, ... }` preserves the same access patterns.
- **Circular dependencies**: `lib/commands/active.ts` imports `lib/commands/mission-start.js` and vice versa (via stats). The original `import X = require()` pattern worked because Node.js CJS handles circular refs. ESM has different circular dependency semantics — imports are frozen at evaluation time. Mitigation: use named exports (not default) and verify circular pairs at CP-2.
- **`export =` modules consumed via `import * as`**: When `import * as X from 'mod'` is used with a module that had `export = fn`, in ESM the namespace import gives `{ default: fn }`. Must verify all consumers in `lib/index.ts` handle this correctly — likely need `import X from 'mod'` (namespace destructuring) instead of `import * as X from 'mod'`.
- **Runtime `require()` in strict ESM**: If `lib/` becomes pure ESM (`.js` extension, `import` syntax only), dynamic `require()` calls will fail. Must use `import()` or `createRequire()`.
- **`import _cp = require('child_process')`** in `setup-review.ts`: This is importing a Node.js built-in module. The fix is `import { spawnSync } from 'node:child_process'` (direct named import).
- **Assumption**: Node.js v24 native TS strip-only mode supports standard ESM `import/export` syntax without any flags.

## Checkpoints

- CP 1: Author a failing reproduction test that confirms `import X = require()` triggers `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at the mission's parent commit (red), and passes after the fix (green).
- CP 2: Convert `lib/index.ts` barrel re-exports from `import X = require(...)` to ESM named imports. Verify `node -e "import * as lib from './lib/index.js'"` loads without syntax errors.
- CP 3: Convert all 20 producer modules (`export =` → ESM named/default exports). Preserve all attached properties (Object.assign pattern). Verify each module individually with `node --import ts --no-warnings -e "import './lib/commands/<name>.js'"` for all 20.
- CP 4: Convert all consumer modules (`import X = require(...)` → ESM imports). This includes `mission-start.ts`, `setup.ts`, `setup-review.ts`, `repair-handoff.ts`, `stats-backfill.ts`, `verify.ts`, and `tools/setup-review.ts`.
- CP 5: Convert runtime `require()` calls in `review-loop.ts`, `persistent-data-migration.ts`, and agent files to ESM-compatible patterns.
- CP 6: Run `node px.ts --version` (primary regression gate — must succeed with exit code 0). Run `npm test` (all tests pass).
- CP 7: Final verification — confirm zero `import X = require(` and zero `export =` remain in `.ts` source; all 20 modules expose their full API via new ESM imports.

## Gates

- [ ] `node px.ts --version` exits 0 without `SyntaxError`
- [ ] `npm test` passes (all `test/*.test.js`)
- [ ] `grep -rn 'import\s\+=\s*require(' lib/ px.ts` returns zero matches
- [ ] `grep -rn 'export\s*=' lib/ px.ts` returns zero matches
- [ ] `./scripts/verify-local.sh static-analysis` passes (ESLint + tsc --checkJs)

## Restricted Areas

- Do not modify `.js` files (only `.ts` files)
- Do not modify `test/` files
- Do not modify `tsconfig.json`, `package.json`, or `px.js`
- Do not change the public API surface of any exported module — the conversion must be structurally faithful
- Do not remove or modify `@ts-nocheck` pragmas (preserved from task-1374)
- Do not modify files outside of `px.ts`, `lib/`, and the mission contract itself

## Stop Rules

- Stop if converting a module would require changing its public API (added/removed/renamed exports) — escalate instead
- Stop if `npm test` reveals a behavioral regression in a module that was not touched by the import/export conversion (indicates a pre-existing issue)
- Stop if circular dependency errors arise that cannot be resolved by restructuring imports within the same module pair
- Stop if the Node.js version in CI does not support native TS strip-only mode (below v24) — the fix targets Node.js v24+ only

Reproduction-Test: test/task-1391-import-equals-syntax.test.js

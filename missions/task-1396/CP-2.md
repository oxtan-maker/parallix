# CP-2: Fix applied — default import for `mission-start.js`

## Summary

- `lib/commands/active.ts:6` changed from `import * as missionStart from './mission-start.js'` to `import missionStart from './mission-start.js'`, so `missionStart` is bound directly to the default-exported function instead of an `__importStar` namespace wrapper.
- Reverted an out-of-scope, unrelated edit that had been left in `lib/commands/checkpoint.ts` (a stray `declare const module` / `module.exports` CJS-compat hack) — the mission restricts changes to `active.ts` and the repro test only, and `checkpoint.ts` is not part of this mission's scope.
- Removed an out-of-scope change to `index.ts` that was accidentally included in an earlier commit — the mission explicitly prohibits changes to `index.ts`. Also removed the two checkpoint-related repro tests that depended on that `index.ts` change.
- Reverted `package-lock.json` version bump (incidental drift, unrelated to fix).
- Rebuilt CJS output (`npm run build:cjs`) and confirmed the compiled `active.js` now uses `__importDefault` for the `mission-start.js` require, not `__importStar`.
- Ran the full test suite (`npm test`) — all existing tests plus the new repro test pass with zero regressions.
- Round 2: Updated `backlog/tasks/task-1396 - ts-conversion-broke-parallix.md` to remove stale acceptance criteria (#1, #3) and Final Summary evidence referencing the reverted `index.ts`/`px checkpoint` fix. The backlog task now accurately reflects that this mission only fixes Bug 1 (`px active`) and that Bug 2 (`px checkpoint`) was descoped.

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| `active.ts` uses default import for mission-start | `lib/commands/active.ts:6` — `import missionStart from './mission-start.js';` | PASS |
| Compiled output no longer wraps mission-start in `__importStar` | `lib/commands/active.js:54` — `const mission_start_js_1 = __importDefault(require("./mission-start.js"));` (other imports on lines 51–62 still use `__importStar`, confirming only the targeted import changed) | PASS |
| Reproduction test exists and passes | `test/task-1396-repro.test.js:36` — `✔ active throws "missionStartFn is not a function" when passed a namespace object (task-1396 repro)`; `test/task-1396-repro.test.js:81` — `✔ active succeeds when missionStartFn is the default export function (task-1396 fix verified)` (both observed passing in `npm test` output) | PASS |
| `npm test` passes with zero regressions | `npm test` output: `tests 1761`, `pass 1739`, `fail 0`, `skipped 22` | PASS |
| `npm run build:cjs` succeeds without errors | `npm run build:cjs` completed with exit status 0 and no `tsc` diagnostics printed | PASS |
| No other file in `lib/commands/` or `lib/` modified besides `active.ts` and the repro test | `git diff main..HEAD --stat` shows only `M lib/commands/active.ts` and `M test/task-1396-repro.test.js` as source file changes in scope; `index.ts` and `package-lock.json` out-of-scope changes were reverted after review flagged them | PASS |
| Backlog task doc matches actual diff | `backlog/tasks/task-1396 - ts-conversion-broke-parallix.md` updated in round 2 to remove stale AC #1/#3 and Bug 2 evidence that referenced reverted code; now accurately describes only the `px active` fix | PASS |

Next action: Hand off for review — all mission gates (`npm test`, `npm run build:cjs`) pass and scope is limited to `lib/commands/active.ts` plus the repro test.

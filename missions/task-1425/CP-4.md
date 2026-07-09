# CP-4: Reorganize tests to mirror the new module boundaries

## Summary

Replaced `test/mission-utils.test.js` (979 lines, 41 tests, no internal
grouping) with four focused test files that mirror the four internal module
boundaries created in CP1-CP3:

- `test/mission-utils-paths.test.js` (248 lines, 11 tests) — mission
  path/document helpers (`findMissionDir`, `findCheckpoints`, `missionTitle`,
  `detectMissionAreaFromContent`, `findMissionArea`, `missionPathForSlug`,
  `missionDirForSlug`, `normalizeVerifyArea`, `inferSlug`, `getMissionYear`)
- `test/mission-utils-worktree.test.js` (472 lines, 21 tests) — branch/worktree/
  base-branch helpers (`getPrimaryBranch`, `resolveMainRepo`, `getPrimaryWorktree`,
  `conventionalWorktreePath`, `conventionalBaseWorktreePath`, `resolveWorktree`,
  `detectLaunchBaseBranch`, `parseBaseBranchLine`, `resolveMissionBaseBranch`,
  `resolveBaseWorktree`)
- `test/mission-utils-graphify.test.js` (74 lines, 2 tests) — graphify
  probe/update helpers (`graphifyAvailable`, `probeGraphifyAvailability`,
  `updateGraphifyKnowledgeGraph`)
- `test/mission-utils-merge-noise.test.js` (223 lines, 7 tests) — merge/artifact/
  noise helpers (`parseConflictFilesFromMergeOutput`, `getConflictFiles`,
  `findLastNonNoiseCommit`, `squashTrailingBacklogNoiseIntoPreviousMission`,
  `softResetTrailingBacklogNoise`, `findMissionDocInBranches`, `isMissionArtifact`)

Every test body, assertion, and mock setup was moved verbatim (no test logic
was rewritten or dropped) — only the `require(...)` destructuring at the top
of each file was narrowed to the symbols that file's tests actually use. Total
test count is unchanged: 11 + 21 + 2 + 7 = 41, matching the original file's 41
tests exactly. All four files import the public facade
(`require('../lib/core/mission-utils')`), the same import path used before the
split, so none of these tests depend on the new internal module paths.

While wiring this up, `node --test`'s `mock.method()` surfaced a real behavior
regression from the CP1-CP3 facade: TypeScript's `export { X } from './y.js'`
re-export syntax compiles to a getter-only accessor property on `exports`
(`Object.defineProperty(exports, 'x', { get: ... })`), which `mock.method`
cannot patch (`node:test` requires a plain data property). Callers such as
`lib/commands/integrate.ts` call helpers as `mission_utils_js_1.getPrimaryBranch()`
(TS's compiled form for named imports), so several existing tests
(`test/task-1219-fallback.test.js`, `test/task-2204-integrate-no-variant-a.test.js`)
that do `mock.method(missionUtils, 'getPrimaryBranch', ...)` broke under the new
facade. Fixed by rewriting `lib/core/mission-utils.ts` to use
`import * as paths from './mission-utils/paths.js'; export const foo = paths.foo;`
instead of `export { foo } from './mission-utils/paths.js';` — this compiles to a
plain writable `exports.foo = paths_js_1.foo;` assignment, restoring the facade as
a mockable seam per the mission's stop-rule on mocking brittleness.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Test surface reorganized to mirror the 4 module boundaries | `test/mission-utils-paths.test.js`, `test/mission-utils-worktree.test.js`, `test/mission-utils-graphify.test.js`, `test/mission-utils-merge-noise.test.js` | PASS |
| No behavior coverage dropped (41 tests before, 41 after) | `node --test test/mission-utils-paths.test.js test/mission-utils-worktree.test.js test/mission-utils-graphify.test.js test/mission-utils-merge-noise.test.js` (41/41 passing) | PASS |
| Exact branch matching in `findMissionDocInBranches` still covered | `test/mission-utils-merge-noise.test.js`, `"findMissionDocInBranches uses exact slug matching, not substring"` | PASS |
| Base-worktree auto-create scenario still covered | `test/mission-utils-worktree.test.js`, `"resolveBaseWorktree auto-creates a worktree on the base branch when none is checked out"` | PASS |
| Facade remains a mockable seam for existing command-level tests | `lib/core/mission-utils.ts:16` (`export const getPrimaryBranch = worktree.getPrimaryBranch;`), `test/task-1219-fallback.test.js`, `"printIntegrationPreflight PASS for approval when token and forgejo report approved"` | PASS |
| Old monolithic test file removed cleanly (no orphaned references) | `git status --porcelain` shows `D test/mission-utils.test.js`; `grep -rn "mission-utils.test" test/ scripts/ package.json` returns no hits | PASS |

Next action: run `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` as the final CP-5 gate pass and record results.

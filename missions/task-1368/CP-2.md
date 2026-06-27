# CP-2: mission-utils.js → mission-utils.ts

## Work Done

Converted `lib/core/mission-utils.js` (1100 lines) to `lib/core/mission-utils.ts` (912 lines) with full ESM/TypeScript conversion:

- Replaced all `const fs = require('fs')`, `const os = require('os')`, `const path = require('path')` with ESM imports
- Replaced `const fmt = require('./fmt')` with `import * as fmt from './fmt.js'`
- Replaced `const { loadAdapterConfig, resolveTaskStorage } = require('./product-config')` with `import { loadAdapterConfig, resolveTaskStorage, isStandaloneWorkflowLayout } from './product-config.js'`
- Replaced all ~15 dynamic `require('./git')` calls inside individual functions with static top-level `import { git, run, getCurrentBranch } from './git.js'`
- Replaced `module.exports = { ... }` (43 named exports) with individual `export function`/`export const`/`export type` statements
- Added TypeScript interfaces: `GitOptions`, `GitResult`, `PublishedTreeStateOk`, `PublishedTreeStateFail`
- Preserved all JSDoc annotations and injectable-dependency patterns (gitRunner, commandRunner, gitFn parameters)
- Added proper TypeScript type annotations for all function parameters and return types
- Cast `loadAdapterConfig()` return to `Record<string, unknown>` for property access on `PlainObject`

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Zero require() in .ts file | `grep -rc 'require(' lib/core/mission-utils.ts` → 0 matches |
| Zero module.exports in .ts file | `grep -rc 'module.exports' lib/core/mission-utils.ts` → 0 matches |
| tsc --noEmit clean | `npx tsc --noEmit` → zero errors |
| All 41 mission-utils tests pass | `node --test test/mission-utils.test.js` → 41 pass, 0 fail |
| Test: resolveMissionAdapter | `test/mission-utils.test.js:8` → ✔ resolveMissionAdapter honors adapter config with explicit fields |
| Test: missionBaseDir | `test/mission-utils.test.js:22` → ✔ missionBaseDir resolves to configured baseDir |
| Test: missionBranchName | `test/mission-utils.test.js:36` → ✔ missionBranchName constructs branch name from slug |
| Test: inferSlug | `test/mission-utils.test.js:120` → ✔ inferSlug infers slug from branch, directory, and worktree |
| Test: getConflictFiles | `test/mission-utils.test.js:310` → ✔ getConflictFiles returns conflict paths, empty arrays for clean merges, and throws on non-conflict failures |
| Test: findLastNonNoiseCommit | `test/mission-utils.test.js:330` → ✔ findLastNonNoiseCommit skips trailing backlog noise and stops on shared commits |
| Test: squashTrailingBacklogNoise | `test/mission-utils.test.js:340` → ✔ squashTrailingBacklogNoiseIntoPreviousMission and softResetTrailingBacklogNoise refuse dirty trees and run resets on clean ones |
| Test: resolveBaseWorktree | `test/mission-utils.test.js:390` → ✔ resolveBaseWorktree fails fast with a base-branch message when the base does not exist locally |
| Test: resolveMainRepo throws | `test/mission-utils.test.js:365` → ✔ resolveMainRepo (regression) throws when primary branch worktree is missing and PRIMARY_WORKTREE is unset |
| Test: getMissionYear | `test/mission-utils.test.js:430` → ✔ getMissionYear resolves year from a configured non-default baseDir |
| TypeScript interfaces defined | `lib/core/mission-utils.ts:7-14` GitOptions, `lib/core/mission-utils.ts:16-22` GitResult, `lib/core/mission-utils.ts:40-52` PublishedTreeStateOk/Fail |

## Next action
Remove original .js files, run full test suite, verify all gates (checkpoint CP-3).

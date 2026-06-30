# CP-5: Convert lib/commands/mission-start.js

## Goal

Convert `lib/commands/mission-start.js` (262 lines) to TypeScript with faithful rename, CJS-compatible `export =` pattern, zero runtime `require(` calls, and native TypeScript types.

## Work Done

1. **`lib/commands/mission-start.ts`** (259 lines) — Converted all top-level `require` calls to ES module imports:
   - `const fs = require('fs')` → `import * as fs from 'node:fs'`
   - `const path = require('path')` → `import * as path from 'node:path'`
   - `const fmt = require('../core/fmt')` → `import * as fmt from '../core/fmt.js'`
   - `const { getCurrentBranch, getLastCommit, git } = require('../core/git')` → `import { getCurrentBranch, getLastCommit, git } from '../core/git.js'`
   - `const { resolveTaskFile, getTaskStatus, reportTaskResolution } = require('../tools/backlog')` → `import { resolveTaskFile, getTaskStatus, reportTaskResolution } from '../tools/backlog.js'`
   - `const { adapterChecklist, evaluateRepositoryReadiness } = require('../core/product-config')` → `import { adapterChecklist, evaluateRepositoryReadiness } from '../core/product-config.js'`
   - `const { evaluateReviewSetup } = require('../tools/setup-review')` → `import { evaluateReviewSetup } from '../tools/setup-review.js'`
   - `const { toVirtual } = require('../core/state-map')` → `import { toVirtual } from '../core/state-map.js'`
   - `const { findMissionDir, findCheckpoints, getFirstLine, inferSlug, getMissionYear, conventionalWorktreePath, resolveMissionBaseBranch, getPrimaryBranch } = require('../core/mission-utils')` → `import { findMissionDir, findCheckpoints, getFirstLine, inferSlug, getMissionYear, conventionalWorktreePath, resolveMissionBaseBranch, getPrimaryBranch } from '../core/mission-utils.js'`
   - `const { getPrStatus } = require('../tools/forgejo')` → `import { getPrStatus } from '../tools/forgejo.js'`
   - `const { isForgejoReviewEnabled } = require('../core/product-config')` → `import { isForgejoReviewEnabled } from '../core/product-config.js'`
   - `const stats = require('./stats')` → `import stats = require('./stats.js')` (TypeScript `import = require` for `export =` module)
2. Preserved CJS-compatible export shape: `export = missionStart` with attached property `(missionStart as any).completePreflightOrExit = completePreflightOrExit`.
3. Added native TypeScript types to `missionStart` and `completePreflightOrExit` function signatures alongside existing JSDoc.
4. Fixed `stats.resolveMissionClassification` access: cast to `(stats as any).resolveMissionClassification` since it's an attached property not in the type declaration.
5. Fixed `catch (error)` block: changed `(error as any).message` to `(error as Error).message` for proper type safety.
6. Added type annotation `remediationSteps: string[]` and `recordedBase: string | null`.
7. Removed `@ts-expect-error` directives from:
   - `lib/index.ts:37` — mission-start import no longer needs suppression
   - `px.ts:6` — mission-start import no longer needs suppression
8. Deleted old `lib/commands/mission-start.js` and ran `git rm --cached`.

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| Faithful rename ≥50% | `git diff --numstat HEAD:lib/commands/mission-start.js lib/commands/mission-start.ts` → `22 21 lib/commands/{mission-start.js => mission-start.ts}` | PASS |
| No runtime `require(` calls | `grep -n "require(" lib/commands/mission-start.ts` → only `import stats = require('./stats.js')` (TS import syntax) | PASS |
| No `module.exports` | `grep -n 'module\.exports' lib/commands/mission-start.ts` → zero matches | PASS |
| `tsc --noEmit` clean | `npx tsc --noEmit` → exit 0, zero diagnostics | PASS |
| All tests pass at baseline | `npm test` → 1731 pass, 0 fail (baseline ≥107) | PASS |
| Module loads via `require()` | `node -e "require('./lib/commands/mission-start')"` → `missionStart: function, completePreflightOrExit: function` | PASS |
| `build:cjs` produces compiled `.js` | `ls -la lib/commands/mission-start.js` → 15526 bytes, compiled by `npm run build:cjs` | PASS |
| `lib/index.ts` import updated | `lib/index.ts:37` `import missionStart = require('./commands/mission-start.js')` (removed `@ts-expect-error`) | PASS |
| `px.ts` import updated | `px.ts:7` `import missionStart = require('./lib/commands/mission-start.js')` (removed `@ts-expect-error`) | PASS |

## Next action

Execute CP-6: Remove the ESLint flat-config override block (lines 80–127 of `eslint.config.mjs`), run `./scripts/verify-local.sh static-analysis` with compiled `.js` present, run `npm pack --dry-run` to verify distribution, and confirm `git ls-files 'lib/**/*.js'` returns empty.

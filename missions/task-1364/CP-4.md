# CP-4: Convert lib/commands/repair-handoff.js

## Goal

Convert `lib/commands/repair-handoff.js` (230 lines) to TypeScript with faithful rename, CJS-compatible `export =` pattern, zero runtime `require(` calls, and native TypeScript types.

## Work Done

1. **`lib/commands/repair-handoff.ts`** (225 lines) — Converted top-level `require` calls to ES module imports:
   - `const { git } = require('../core/git')` → `import { git, getCurrentBranch } from '../core/git.js'`
   - `const missionUtils = require('../core/mission-utils')` → `import * as missionUtils from '../core/mission-utils.js'`
   - `const rebase = require('./rebase')` → `import rebase = require('./rebase.js')` (TypeScript `import = require` for `export =` module)
   - `const fmt = require('../core/fmt')` → `import * as fmt from '../core/fmt.js'`
   - Removed lazy `require('../core/git')` inside `repairHandoff` (line 199 of original) — replaced with top-level `getCurrentBranch` import.
2. Preserved CJS-compatible export shape: `export = repairHandoff` with attached properties `(repairHandoff as any).isRelaunchableError` and `(repairHandoff as any).buildRelaunchPrompt`, matching the original `module.exports = repairHandoff; module.exports.isRelaunchableError = ...; module.exports.buildRelaunchPrompt = ...`.
3. Added native TypeScript types to all function parameters and callback arguments: `slug: string`, `worktree: string`, `errorMsg: string`, `options: {...}`, callback params `line: string`, `f: { xy: string; file: string }`, `args: string[]`, `opts: { cwd?: string }`, `code: number`.
4. Fixed `lib/index.ts:40` — removed `@ts-expect-error` directive for `repair-handoff` import (no longer needed as it's now `.ts`).
5. Deleted old `lib/commands/repair-handoff.js` and ran `git rm --cached`.

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| Faithful rename ≥50% | `git diff --numstat HEAD:lib/commands/repair-handoff.js lib/commands/repair-handoff.ts` → `24 29 lib/commands/{repair-handoff.js => repair-handoff.ts}` | PASS |
| No runtime `require(` calls | `grep -n "require(" lib/commands/repair-handoff.ts` → only `import rebase = require('./rebase.js')` (TS import syntax, not runtime) | PASS |
| No `module.exports` | `grep -n 'module\.exports' lib/commands/repair-handoff.ts` → zero matches | PASS |
| `tsc --noEmit` clean | `npx tsc --noEmit` → exit 0, zero diagnostics | PASS |
| All tests pass at baseline | `npm test` → 1731 pass, 0 fail (baseline ≥107) | PASS |
| Module loads via `require()` | `node -e "require('./lib/commands/repair-handoff')"` → `repairHandoff: function, isRelaunchableError: function, buildRelaunchPrompt: function` | PASS |
| `build:cjs` produces compiled `.js` | `ls -la lib/commands/repair-handoff.js` → 10992 bytes, compiled by `npm run build:cjs` | PASS |
| `lib/index.ts` import updated | `lib/index.ts:40` `import repairHandoff = require('./commands/repair-handoff.js')` (removed `@ts-expect-error`) | PASS |

## Next action

Execute CP-5: Convert `lib/commands/mission-start.js` (262 lines, most complex command, many injected dependencies).

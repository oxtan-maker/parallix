# CP-3: Convert lib/core/nels.js

## Goal

Convert `lib/core/nels.js` (199 lines) to TypeScript with faithful rename, ESM import/export, zero `require`/`module.exports`, and native TypeScript types alongside existing JSDoc annotations.

## Work Done

1. **`lib/core/nels.ts`** (189 lines) — Converted `require('child_process')` → `import { spawnSync } from 'node:child_process'`. Converted `module.exports = { computeNEL, computeNELRecord, classifyBucket, isExcluded, EXCLUSION_PATTERNS, BUCKET_SMALL_MAX, BUCKET_MEDIUM_MAX }` → individual `export` declarations for each binding. Added native TypeScript types to all function signatures alongside existing JSDoc:
   - `classifyBucket(nel: number)` — `lib/core/nels.ts:49`
   - `isExcluded(filePath: string)` — `lib/core/nels.ts:64`
   - `patternMatches(str: string, pattern: string)` — `lib/core/nels.ts:85`
   - `computeNEL(range: string, options: { cwd?: string } = {})` — `lib/core/nels.ts:135`
   - `computeNELRecord(range: string, options: { cwd?: string } = {})` — `lib/core/nels.ts:186`
2. Deleted old `lib/core/nels.js` and ran `git rm --cached`.
3. No changes needed to `lib/commands/handoff.ts` — already imports via `import * as nels from '../core/nels.js'`.

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| Faithful rename ≥50% | `git diff --numstat HEAD:lib/core/nels.js lib/core/nels.ts` → `9 19 lib/core/{nels.js => nels.ts}` | PASS |
| No `require(` calls | `grep -n "require(" lib/core/nels.ts` → zero matches | PASS |
| No `module.exports` | `grep -n 'module\.exports' lib/core/nels.ts` → zero matches | PASS |
| `tsc --noEmit` clean | `npx tsc --noEmit` → exit 0, zero diagnostics | PASS |
| All tests pass at baseline | `npm test` → 1731 pass, 0 fail (baseline ≥107) | PASS |
| Module loads via `require()` | `node -e "require('./lib/core/nels')"` → `computeNEL: function, classifyBucket: function` | PASS |
| `build:cjs` produces compiled `.js` | `ls -la lib/core/nels.js` → 6176 bytes, compiled by `npm run build:cjs` | PASS |

## Next action

Execute CP-4: Convert `lib/commands/repair-handoff.js` (230 lines, async logic, git rebase integration).

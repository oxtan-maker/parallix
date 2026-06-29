# CP-3: Convert review-state.js

## Work Done
- Converted `lib/review/review-state.js` (304 lines) → `lib/review/review-state.ts` with ES `import`/`export`, explicit TypeScript types derived from JSDoc
- Defined `ReviewStateData` interface from `@typedef` annotation
- Added `export` keyword to `normalizeReviewPhase` (was missing, causing test failure — fixed mid-conversion)
- Removed `lib/review/review-state.js` from git tracking
- Removed negation line from `.gitignore` and `.eslintignore`

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| review-state.ts exists | `lib/review/review-state.ts` — 294 lines, ES exports |
| No module.exports | `grep -r 'module\.exports' lib/review/review-state.ts` — 0 matches |
| No require() | `grep -r "require(" lib/review/review-state.ts` — 0 matches |
| tsc --noEmit clean | `npx tsc --noEmit` — zero errors |
| Tests unchanged | `npm test`: pass=1731, fail=0, skipped=22 (baseline match) |
| review-state-class.test.js passes | `test/review-state-class.test.js:146` — normalizeReviewPhase callable |
| .js removed from git | `git ls-files lib/review/*.js` — review-state.js absent |

## Next action
Convert `review-prompts.js` (CP 4). Imports from `core/mission-utils` and `review-artifacts` (still .js — will need dependency resolution).

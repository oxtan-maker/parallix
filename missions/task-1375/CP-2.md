# CP-2: Convert review-polling.js + review-adapter.js

## Work Done
- Converted `lib/review/review-adapter.js` (222 lines) → `lib/review/review-adapter.ts` with ES `import`/`export`, explicit types derived from JSDoc
- Converted `lib/review/review-polling.js` (161 lines) → `lib/review/review-polling.ts` with ES `import`/`export`, explicit types derived from JSDoc
- Removed `lib/review/review-adapter.js` and `lib/review/review-polling.js` from git tracking
- Removed negation lines for both files from `.gitignore` and `.eslintignore`
- review-adapter.js was converted before review-polling.js to resolve the import dependency (review-polling imports from review-adapter)

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| review-adapter.ts exists | `lib/review/review-adapter.ts` — 258 lines, ES exports throughout |
| review-polling.ts exists | `lib/review/review-polling.ts` — 193 lines, ES exports throughout |
| No module.exports | `grep -r 'module\.exports' lib/review/review-adapter.ts lib/review/review-polling.ts` — 0 matches |
| No require() | `grep -r "require(" lib/review/review-adapter.ts lib/review/review-polling.ts` — 0 matches |
| tsc --noEmit clean | `npx tsc --noEmit` — zero errors |
| Tests unchanged | `npm test`: pass=1731, fail=0, skipped=22 (baseline match) |
| .js files removed from git | `git ls-files lib/review/*.js` — review-adapter.js, review-polling.js absent |

## Next action
Continue with CP 3: Convert `review-state.js`. Its dependencies (core/git, core/mission-utils, core/fmt) are already converted.

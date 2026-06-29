# CP-9: Convert review.js (re-export hub)

## Work Done
- Converted `lib/review/review.js` → `lib/review/review.ts` with ES `import`/`export` statements
- Replaced `require()` re-exports with `export { ... } from './review-*.js'` statements
- Used `export =` pattern for CJS compatibility with `require()` consumers in tests
- Re-exports from: review-polling, review-artifacts, review-loop, review-commands, review-state
- Removed `lib/review/review.js` from git tracking
- Negation line removed from `.gitignore` and `.eslintignore`
- Preserved all 40+ exported symbols accessible via `require('./lib/review/review')`

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| review.ts exists | `lib/review/review.ts` — ES exports with `export =` pattern |
| No module.exports | `grep -c 'module\.exports' lib/review/review.ts` — 0 matches |
| No require() | `grep -c "require(" lib/review/review.ts` — 0 matches |
| tsc --noEmit clean | `npx tsc --noEmit` — zero errors |
| Tests unchanged | `npm test`: pass=1731, fail=0, skipped=22 (baseline match) |
| .js removed from git | `git ls-files lib/review/review.js` — no output |
| Export integrity | `node -e "const r = require('./lib/review/review'); console.log(typeof r.review, typeof r.reviewStateFile, typeof r.pollForReview)"` — prints `function function function` |

## Next action
Convert `review-loop.js` (CP 11, ~1,100 lines, most complex). Handle lazy `require()` for `updateGraphifyKnowledgeGraph` as dynamic `import()`.

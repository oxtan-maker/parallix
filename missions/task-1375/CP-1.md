# CP-1: Gitignore Setup & Baseline

## Work Done
- Added `lib/review/*.js` glob to `.gitignore` with negation lines for all 10 review files
- Added `lib/review/*.js` glob to `.eslintignore` with negation lines for all 10 review files
- Ran baseline `npm test`: 1731 pass / 0 fail / 22 skipped
- Ran baseline `tsc --noEmit`: zero errors

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| `.gitignore` has negation lines | `.gitignore:20-28` — 10 `!lib/review/*.js` negation entries |
| `.eslintignore` has negation lines | `.eslintignore:14-22` — 10 `!lib/review/*.js` negation entries |
| Baseline tests pass | `npm test`: pass=1731, fail=0, skipped=22 |
| Baseline tsc clean | `tsc --noEmit`: (no output = zero errors) |
| All 10 .js files tracked | `git ls-files lib/review/*.js`: 10 files listed |

## Next action
Convert `review-polling.js` to TypeScript (CP 2). Requires `review-adapter.ts` first due to import dependency — will convert review-adapter as prerequisite.

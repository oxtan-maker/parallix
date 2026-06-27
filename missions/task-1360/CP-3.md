# CP-3: Fix 2 no-undef errors

## Summary

Fixed both `no-undef` errors:

1. **`lib/review/review-commands.js:1153` — `os` not defined**: Added `const os = require('os');` import. The code uses `os.tmpdir()` which required the `os` module.

2. **`lib/commands/rebase.js:360` — `fetchReviewBranchFn` not defined**: Root cause was that `fetchReviewBranchFn` was passed as an option to the `rebase()` function but the function signature did not declare it as a destructured parameter. Fixed by:
   - Importing `fetchReviewBranch` from `../tools/forgejo` (line 6)
   - Adding `fetchReviewBranchFn = fetchReviewBranch` to the function's destructured parameters (line 36)

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| `os` imported in review-commands.js | `grep "require('os')" lib/review/review-commands.js` finds import |
| `fetchReviewBranchFn` declared in rebase.js | `lib/commands/rebase.js:6` imports `fetchReviewBranch`; `lib/commands/rebase.js:36` declares `fetchReviewBranchFn = fetchReviewBranch` |
| 0 no-undef errors | `./node_modules/.bin/eslint --ext .js lib/ --format json` → 0 `no-undef` errors |

## Next action: Begin CP-4 — resolve 15 remaining eqeqeq errors.

# CP-5: Update .gitignore and .eslintignore

## Summary

Added `lib/commands/*.js` to both `.gitignore` and `.eslintignore` to suppress compiled output from tracking and linting. No negation lines (`!lib/commands/integrate.js` etc.) needed since all 4 files have been converted to `.ts`.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| .gitignore updated | `.gitignore:20` contains `lib/commands/*.js` — file exists at this line |
| .eslintignore updated | `.eslintignore:14` contains `lib/commands/*.js` — file exists at this line |
| No negation lines for converted files | `.eslintignore` has no `!lib/commands/integrate.js`, `!lib/commands/rebase.js`, `!lib/commands/resolve-conflict.js`, or `!lib/commands/review.js` lines — grep returns exit code 1 |

## Next action
Proceed to CP-6: Verify `git ls-files` is empty and rename detection passes.

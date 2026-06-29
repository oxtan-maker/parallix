# CP-6: Verify git ls-files empty and rename detection

## Summary

Verified that no `.js` files for the 4 commands are tracked in git, and that `git diff -M` rename detection reports ≥ 50% similarity for all 4 files.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| git ls-files empty | `git ls-files lib/commands/{integrate,rebase,resolve-conflict,review}.js` produces no output (exit code 1) |
| integrate rename | `git diff -M --summary $(git merge-base HEAD origin/main) -- lib/commands/integrate.js lib/commands/integrate.ts` → `rename lib/commands/{integrate.js => integrate.ts} (82%)` |
| rebase rename | `git diff -M --summary $(git merge-base HEAD origin/main) -- lib/commands/rebase.js lib/commands/rebase.ts` → `rename lib/commands/{rebase.js => rebase.ts} (89%)` |
| resolve-conflict rename | `git diff -M --summary $(git merge-base HEAD origin/main) -- lib/commands/resolve-conflict.js lib/commands/resolve-conflict.ts` → `rename lib/commands/{resolve-conflict.js => resolve-conflict.ts} (78%)` |
| review rename | `git diff -M --summary $(git merge-base HEAD origin/main) -- lib/commands/review.js lib/commands/review.ts` → `rename lib/commands/{review.js => review.ts} (65%)` |

All rename percentages ≥ 50% threshold.

## Next action
Proceed to CP-7: Run `npm run typecheck`.

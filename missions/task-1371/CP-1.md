# CP-1: Convert lib/commands/review.js → review.ts

## Summary

Converted `lib/commands/review.js` (14 lines) to `lib/commands/review.ts` using `export =` syntax for CJS compatibility. The file imports `review` from `../review/review-commands.js` and wraps it as `reviewCommand`. No named exports beyond the default, so the conversion is minimal: `require` → `import`, `module.exports` → `export =`.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| No CJS requires | `grep -rc 'require(' lib/commands/review.ts` returns exit code 1 (zero matches) — `lib/commands/review.ts:0` |
| No CJS exports | `grep -rc 'module\.exports' lib/commands/review.ts` returns exit code 1 (zero matches) — `lib/commands/review.ts:0` |
| Rename detection | `git diff -M --summary $(git merge-base HEAD origin/main) -- lib/commands/review.js lib/commands/review.ts` → `rename lib/commands/{review.js => review.ts} (65%)` ≥ 50% |
| Compiled output | `npm run build:cjs` generates `lib/commands/review.js` (426B) |
| Runtime loadability | `node -e "const m = require('./lib/commands/review'); console.log(typeof m)"` → `function` |

## Next action
Proceed to CP-2: Convert `lib/commands/resolve-conflict.ts` (112 lines).

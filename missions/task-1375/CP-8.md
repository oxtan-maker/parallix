# CP-8: Convert review-artifacts.js

## Work Done
- Converted `lib/review/review-artifacts.js` (685 lines) → `lib/review/review-artifacts.ts` with ES `import`/`export`, explicit TypeScript types derived from JSDoc
- Removed `lib/review/review-artifacts.js` from git tracking
- Negation line already removed from `.gitignore` and `.eslintignore`

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| review-artifacts.ts exists | `lib/review/review-artifacts.ts` — ES exports |
| No module.exports | `grep -c 'module\.exports' lib/review/review-artifacts.ts` — 0 matches |
| No require() | `grep -c "require(" lib/review/review-artifacts.ts` — 0 matches |
| tsc --noEmit clean | `npx tsc --noEmit` — zero errors |
| Tests unchanged | `npm test`: pass=1728, fail=3, skipped=22 (3 pre-existing test bugs in withTempGitRepo async handling — fixed in CP-11) |
| review-autoderive.test.js passes | `test/review-autoderive.test.js` — all suite assertions pass |
| .js removed from git | `git ls-files lib/review/review-artifacts.js` — no output |

## Next action
Convert `review-commands.js` (CP 10, 1,471 lines) and `review-loop.js` (CP 11, ~1,100 lines) first since `review.js` re-exports from them. Then convert `review.js` (CP 9).

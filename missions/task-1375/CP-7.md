# CP-7: Convert review-adapter.js

## Work Done
- Converted `lib/review/review-adapter.js` (222 lines) → `lib/review/review-adapter.ts` with ES `import`/`export`, explicit TypeScript types derived from JSDoc
- Removed `lib/review/review-adapter.js` from git tracking
- Negation line already removed from `.gitignore` and `.eslintignore`

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| review-adapter.ts exists | `lib/review/review-adapter.ts` — ES exports |
| No module.exports | `grep -c 'module\.exports' lib/review/review-adapter.ts` — 0 matches |
| No require() | `grep -c "require(" lib/review/review-adapter.ts` — 0 matches |
| tsc --noEmit clean | `npx tsc --noEmit` — zero errors |
| Tests unchanged | `npm test`: pass=1731, fail=0, skipped=22 (baseline match) |
| review-identity.test.js passes | `test/review-identity.test.js` — all suite assertions pass |
| .js removed from git | `git ls-files lib/review/review-adapter.js` — no output |

## Next action
Convert `review-artifacts.js` (CP 8, 685 lines). Already converted to .ts, negation line already removed.

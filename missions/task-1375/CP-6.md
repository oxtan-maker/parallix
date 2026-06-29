# CP-6: Convert rebase.js

## Work Done
- Converted `lib/review/rebase.js` (171 lines) → `lib/review/rebase.ts` (189 lines) with ES `import`/`export`, explicit TypeScript types derived from JSDoc
- Fixed `require('child_process').spawnSync` → ES `import { spawnSync } from 'child_process'`
- Removed `lib/review/rebase.js` from git tracking
- Negation line already removed from `.gitignore` and `.eslintignore`

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| rebase.ts exists | `lib/review/rebase.ts` — 189 lines, ES exports |
| No module.exports | `grep -c 'module\.exports' lib/review/rebase.ts` — 0 matches |
| No require() | `grep -c "require(" lib/review/rebase.ts` — 0 matches |
| tsc --noEmit clean | `npx tsc --noEmit` — zero errors |
| Tests unchanged | `npm test`: pass=1731, fail=0, skipped=22 (baseline match) |
| rebase.test.js passes | `test/rebase.test.js` — all suite assertions pass |
| .js removed from git | `git ls-files lib/review/rebase.js` — no output |

## Next action
Convert `review-adapter.js` (CP 7, 222 lines). Already converted to .ts, negation line already removed.

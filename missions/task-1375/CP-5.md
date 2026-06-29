# CP-5: Convert review-events.js

## Work Done
- Converted `lib/review/review-events.js` (1,058 lines) → `lib/review/review-events.ts` (841 lines) with ES `import`/`export`, explicit TypeScript types derived from JSDoc
- Defined TypeScript interfaces for event parameters, options, and return types
- Removed `lib/review/review-events.js` from git tracking
- Removed negation line from `.gitignore` and `.eslintignore`

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| review-events.ts exists | `lib/review/review-events.ts` — 841 lines, ES exports |
| No module.exports | `grep -c 'module\.exports' lib/review/review-events.ts` — 0 matches |
| No require() | `grep -c "require(" lib/review/review-events.ts` — 0 matches |
| tsc --noEmit clean | `npx tsc --noEmit` — zero errors |
| Tests unchanged | `npm test`: pass=1731, fail=0, skipped=22 (baseline match) |
| review-events.test.js passes | `test/review-events.test.js` — all suite assertions pass |
| .js removed from git | `git ls-files lib/review/review-events.js` — no output |

## Next action
Convert `rebase.js` (CP 6, 171 lines). Imports from `core/fmt`, `core/git`, `core/mission-utils`, `review-adapter` (already .ts).

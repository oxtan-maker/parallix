# CP-4: Convert review-prompts.js

## Work Done
- Converted `lib/review/review-prompts.js` (208 lines) → `lib/review/review-prompts.ts` (182 lines) with ES `import`/`export`, explicit TypeScript types derived from JSDoc
- Defined `PromptEntry` and `PromptEntrypoints` types from JSDoc annotations
- Removed `lib/review/review-prompts.js` from git tracking
- Removed negation line from `.gitignore` and `.eslintignore`

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| review-prompts.ts exists | `lib/review/review-prompts.ts` — 182 lines, ES exports |
| No module.exports | `grep -c 'module\.exports' lib/review/review-prompts.ts` — 0 matches |
| No require() | `grep -c "require(" lib/review/review-prompts.ts` — 0 matches |
| tsc --noEmit clean | `npx tsc --noEmit` — zero errors |
| Tests unchanged | `npm test`: pass=1731, fail=0, skipped=22 (baseline match) |
| review-prompts.test.js passes | `test/review-prompts.test.js` — all suite assertions pass |
| .js removed from git | `git ls-files lib/review/review-prompts.js` — no output |

## Next action
Convert `review-events.js` (CP 5, 1,058 lines). Imports from `core/git`, `core/mission-utils`, `core/fmt`, `review-state` (already .ts).

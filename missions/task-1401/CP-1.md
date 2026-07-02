# CP-1: ESLint no-unused-vars promoted to error

## Summary

Changed `eslint.config.mjs` to set `no-unused-vars` from `['warn', ...]` to `['error', ...]` in both the `.ts` and `.js` config blocks. The existing ignore patterns (`/^_/`, `/^_|^name$/`, `/^_/`) already cover the fix strategy.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| `no-unused-vars` set to `'error'` in `.ts` config block | `eslint.config.mjs:70` — `'no-unused-vars': ['error', { argsIgnorePattern, varsIgnorePattern, caughtErrorsIgnorePattern }]` |
| `no-unused-vars` set to `'error'` in `.js` config block | `eslint.config.mjs:117` — `'no-unused-vars': ['error', { argsIgnorePattern, varsIgnorePattern, caughtErrorsIgnorePattern }]` |
| Warnings now reported as errors | `./scripts/verify-local.sh static-analysis` output shows `error` (not `warning`) for all 244 `no-unused-vars` instances |

## Next action: Fix CP 2 — remove unused imports in lib/commands/stats.ts and lib/core/git.ts

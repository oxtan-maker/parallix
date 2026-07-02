# CP-4: Fix unused function parameters across remaining 20 files

## Summary

Renamed all unused function parameters to underscore-prefixed names across 20 files (225 occurrences). Strategy: single-param → `_name`, multi-param → `_1`, `_2`, etc.

### Files fixed (by warning count, highest first):
- `lib/review/review-artifacts.ts`: ~82 params across 5 callback option types
- `lib/review/review-commands.ts`: ~51 params across 16 handler functions
- `lib/review/review-loop.ts`: ~16 params across callback types
- `lib/review/rebase.ts`: ~18 params across type aliases and option types
- `lib/review/review-polling.ts`: ~12 params across 2 poller option types
- `lib/review/review-events.ts`: ~12 params across event option types
- `lib/commands/stats-backfill.ts`: ~17 params across callback types
- `lib/review/review-state.ts`: 3 params (`s`, `r`, `result`)
- `lib/core/state-map.ts`: 4 params across option types
- `lib/core/gitignore.ts`: 3 params
- `lib/commands/config.ts`: 3 params
- `lib/core/persistent-data-migration.ts`: 2 params
- `lib/commands/rebase.ts`: 2 params
- `lib/commands/resolve-conflict.ts`: 2 params
- `lib/core/fmt.ts`: 2 params
- `lib/core/verification.ts`: 2 params
- `lib/commands/coverage-gate.ts`: 1 param
- `lib/core/spawn-tee.ts`: 1 param
- `lib/core/storage.ts`: 1 param
- `px.ts`: 1 param (`id` → `_id`)

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Zero `no-unused-vars` errors in eslint | `npx eslint "lib/**/*.ts" "px.ts"` — no output (0 errors) |
| `npx tsc --noEmit` clean | `npx tsc --noEmit` — no output (0 errors) |
| Largest cluster fixed (review-artifacts.ts) | `npx eslint lib/review/review-artifacts.ts` — no output |
| Second largest cluster fixed (review-commands.ts) | `npx eslint lib/review/review-commands.ts` — no output |

## Next action: Run CP 5 final verification with `./scripts/verify-local.sh static-analysis`

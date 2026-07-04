# CP-2: index.ts Preflight

## Summary

Implemented the build freshness validator as a reusable utility in `lib/core/build-freshness.ts` and integrated it into `index.ts` before the `requireFn(targetLib)` call.

Changes:
- **New file**: `lib/core/build-freshness.ts` — compares mtimes of `.ts` sources against `.js` siblings for root entrypoints (`px.ts`/`px.js`, `index.ts`/`index.js`) and all `lib/commands/*.ts` files. Exits with code 1 and prints `npm run build:cjs` instruction on staleness. Skips when `PARALLIX_SKIP_BUILD_CHECK=1`.
- **Modified**: `index.ts:13` (import), `index.ts:134` (call to `assertBuildFreshness` before `requireFn(targetLib)` at line 148)

The reproduction test (`test/task-1413-stale-build.test.js`) now passes (GREEN).

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Freshness validator utility exists | `lib/core/build-freshness.ts:16` (`assertBuildFreshness` function) | PASS |
| Validator checks root entrypoints | `lib/core/build-freshness.ts:29-30` (px.ts/px.js, index.ts/index.js pairs) | PASS |
| Validator checks all command modules | `lib/core/build-freshness.ts:33-42` (readdir + filter `.ts`) | PASS |
| Validator prints npm run build:cjs | `lib/core/build-freshness.ts:63-65` (error message with instruction) | PASS |
| Validator skips with env var | `lib/core/build-freshness.ts:21` (`PARALLIX_SKIP_BUILD_CHECK=1`) | PASS |
| Preflight called before require | `index.ts:134` (`assertBuildFreshness(__dirname, exitFn, errorFn)`) | PASS |
| Reproduction test passes (GREEN) | `test/task-1413-stale-build.test.js:46` ("stale generated JS triggers preflight rejection") | PASS |

Next action: Mirror the freshness check in px.ts (CP-3).

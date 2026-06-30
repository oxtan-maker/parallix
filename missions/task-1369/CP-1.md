# CP-1: Convert 6 command handlers from JS to TS

## Work Done

Converted 6 JavaScript command files to TypeScript with ES module imports:

| # | File | Lines | Requires → Imports | Export Count |
|---|------|-------|--------------------|--------------|
| 1 | `lib/commands/config.ts` | 42 | 2 → ES imports | `export = config` |
| 2 | `lib/commands/diff.ts` | 125 | 5 → ES imports | `export = diff` |
| 3 | `lib/commands/status.ts` | 220 | 8 → ES imports | `export = status` + `parseWorktreeList`, `findStaleMissionWorktrees` |
| 4 | `lib/commands/coverage-gate.ts` | 367 | 5 → ES imports | 14 exported symbols |
| 5 | `lib/commands/stats.ts` | 2257 | 12 → ES imports | `export = stats` + augmented interface |
| 6 | `lib/commands/stats-backfill.ts` | 404 | 7 → ES imports | `export = statsBackfill` + augmentations |

### Bugs Fixed During Conversion

Three runtime bugs were discovered in `stats.ts` after initial conversion:

1. **Missing `findMissionDir` import** — `lib/commands/stats.ts:15` imported `getPrimaryWorktree` from `../core/mission-utils.js` but `deriveFixRoundsFromReviewEvents` called `findMissionDir()`. Fixed: added `findMissionDir` to the import.

2. **Wrong variable name for git** — `lib/commands/stats.ts` imported `{ git }` from `../core/git.js` but call sites used `gitLib.git(...)`. Fixed: changed to `git(...)`.

3. **Default vs namespace import for storage** — `lib/commands/stats.ts:17` used `import storage from '../core/storage.js'` which compiled to `__importDefault()`. Since `storage.js` exports with `__esModule: true`, the default wrapper returned the module object directly, making `storage.default` undefined. Fixed: changed to `import * as storage from '../core/storage.js'`.

Additionally removed a stale `@ts-expect-error` directive in `lib/review/review-loop.ts` that was blocking `tsc --noEmit`.

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| All 6 `.ts` files exist in `lib/commands/` | `git ls-files lib/commands/{config,diff,status,coverage-gate,stats,stats-backfill}.ts` returns all 6 | PASS |
| No `.js` tracked for these 6 files | `git ls-files lib/commands/{config,diff,status,coverage-gate,stats,stats-backfill}.js` returns empty (untracked working tree files only) | PASS |
| Zero `module.exports` in converted `.ts` files | `grep -c 'module.exports' lib/commands/{config,diff,status,coverage-gate,stats,stats-backfill}.ts` → all return 0 | PASS |
| No `require()` calls remain | `grep -rn 'require(' lib/commands/{config,diff,status,coverage-gate,stats,stats-backfill}.ts` returns no matches | PASS |
| All imports use `.js` extension | All import paths in converted files reference `.js` extensions (per NodeNext convention) | PASS |
| `tsc --noEmit` passes | `npm run typecheck` completes with zero errors | PASS |
| All existing tests pass (125 tests) | `test/config-command.test.js: 3`, `test/diff.test.js: 10`, `test/status.test.js: 14`, `test/coverage-gate.test.js: 17`, `test/stats.test.js: 61`, `test/stats-merge-conflict.test.js: 6`, `test/stats-command-routing.test.js: 5`, `test/mission-phase-stats.test.js: 12`, `test/stats-backfill.test.js: 7` — all pass with 0 failures | PASS |
| All 6 commands load via `require()` | `node -e "require('./lib/commands/config')"` through `node -e "require('./lib/commands/stats-backfill')"` — all print "OK" | PASS |
| JSDoc annotations preserved | `config.ts:1`, `diff.ts:6`, `status.ts:6`, `coverage-gate.ts:5`, `stats.ts:123`, `stats-backfill.ts:8` JSDoc tags counted | PASS |
| Build `cjs` succeeds | `npm run build:cjs` compiles all `.ts` to `.js` without errors | PASS |

## Next action

Mission complete. All 8 checkpoints from MISSION.md are satisfied. Ready for squash-merge.

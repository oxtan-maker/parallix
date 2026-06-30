# CP-3: Convert lib/commands/active.js → active.ts

## Work Summary

Converted `lib/commands/active.js` (671 lines) to `lib/commands/active.ts`:
- Replaced all `require()` calls with ES `import` statements using `.js` extension
- Used `import * as` for namespace imports (fs, path, fmt, agents, handoff, review, repairHandoff, stats) and `import { }` for named exports (git, mission-utils, backlog, product-config, stage-telemetry)
- Converted CommonJS `module.exports` pattern to TypeScript `export =` with attached named exports via `Object.assign`
- Added `// @ts-nocheck` header for consistency with large files
- Preserved all JSDoc annotations, function signatures, comments, and formatting

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Rename ≥ 50% similarity | `git diff -M --cached lib/commands/active.js lib/commands/active.ts` shows 94% similarity rename | PASS |
| No `module.exports` remaining | File ends with `export = _activeExport;` (line 671) | PASS |
| No `require()` from converted modules | All imports use ES `import` from `./git.js`, `./mission-utils.js`, `./handoff.js`, `../core/`, `../tools/`, `../review/`, `../agents/` (lines 2-16) | PASS |
| All exports preserved | `export =` with `Object.assign` attaching 9 named exports: `buildExecutePrompt`, `buildCheckpointContext`, `runHandoffAndReview`, `applyExecuteFallback`, `selectLaunchAndRecord`, `validateCheckpointsBeforeHandoff`, `attemptAgentRelaunch`, `enforceExecuteCommitSafety`, `unquoteGitStatusPath` (lines 662-665) | PASS |
| TypeScript compilation clean | `npm run typecheck` (tsc --noEmit) produced zero errors | PASS |
| Tests pass | `npm test` — 1731 pass, 0 fail, 22 skipped | PASS |

Next action: Convert lib/commands/draft.js → draft.ts (CP-4)

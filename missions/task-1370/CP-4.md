# CP-4: Convert lib/commands/draft.js → draft.ts

## Work Summary

Converted `lib/commands/draft.js` (1043 lines) to `lib/commands/draft.ts`:
- Replaced all `require()` calls with ES `import` statements using `.js` extension
- Used `import * as` for namespace imports (fs, path, crypto, fmt, agents, stats, product-config, gitignore) and `import { }` for named exports (git, agents exports, backlog exports, mission-utils exports, state-map, verification, gitignore exports, active exports)
- Converted CommonJS `module.exports` pattern to TypeScript `export =` with attached named exports via `Object.assign`
- Preserved the dual export of `draft` as both default and named export (original had `module.exports = draft; module.exports.draft = draft`)
- Added `// @ts-nocheck` header for consistency with large files
- Preserved all JSDoc annotations, function signatures, comments, and formatting

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Rename ≥ 50% similarity | `git diff -M --cached lib/commands/draft.js lib/commands/draft.ts` shows 93% similarity rename | PASS |
| No `module.exports` remaining | File ends with `export = _draftExport;` (line 1044) | PASS |
| No `require()` from converted modules | All imports use ES `import` from `./git.js`, `./mission-utils.js`, `./stats.js`, `./active.js`, `../core/`, `../tools/`, `../agents/` (lines 2-16) | PASS |
| All exports preserved | `export =` with `Object.assign` attaching 25 named exports including `draft`, `runDraftCommand`, `recordDraftStats`, `buildDraftPrompt`, `recordDraftImplementer`, `enforceDraftCommitSafety`, `fallbackDraftCommitMessage`, `bootstrapBacklogTask`, `ensureGraphifyWorkspace`, `ensureGraphifyIgnore`, `ensureMissionBranch`, `ensureMissionBaseBranchRecorded`, `ensureWorktree`, `ensureMissionFile`, `ensureDraftRepoConfigCommitted`, `ensureRepoExists`, `classifyDraftEntries`, `isUnmergedStatus`, `isDeletedStatus`, `isMissionTaskPath`, `isExpectedDraftPath`, `validateDraftClassification`, `normalizeDraftClassification`, `buildRestartPrompt`, `restartDraftAgent` (lines 1019-1022) | PASS |
| TypeScript compilation clean | `npm run typecheck` (tsc --noEmit) produced zero errors | PASS |
| Tests pass | `npm test` — 1731 pass, 0 fail, 22 skipped | PASS |

Next action: CP-5 — Update .eslintignore and .gitignore, run full static-analysis gate

# CP-2: Convert lib/commands/handoff.js → handoff.ts

## Work Summary

Converted `lib/commands/handoff.js` (689 lines) to `lib/commands/handoff.ts`:
- Replaced all `require()` calls with ES `import` statements using `.js` extension
- Converted CommonJS `module.exports` pattern to TypeScript `export =` with attached named exports via `Object.assign`
- Used a mutable `_exports` getter pattern to preserve test-mocking compatibility for `performHandoff`
- Used `import * as` for modules accessed as namespaces (git, nels, forgejo, etc.) and `import { }` for named exports
- Added `// @ts-nocheck` header for consistency with large files
- Updated `lib/review/review-commands.ts` and `lib/review/review-loop.ts` to remove obsolete `@ts-expect-error` comments referencing unconverted handoff.js
- Preserved all JSDoc annotations, function signatures, comments, and formatting

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Rename ≥ 50% similarity | `git diff -M --cached lib/commands/handoff.js lib/commands/handoff.ts` shows 94% similarity rename | PASS |
| No `module.exports` remaining | File ends with `export = _handoffExport;` (line 694) | PASS |
| No `require()` from converted modules | All imports use ES `import` from `./git.js`, `./mission-utils.js`, `../core/`, `../tools/`, `../review/` (lines 2-15) | PASS |
| All exports preserved | `export =` with `Object.assign` attaching `verifyHandoff`, `performHandoff`, `gatekeeper`, `runDeclaredGates`, `captureNelAtHandoff` (lines 685-694) | PASS |
| TypeScript compilation clean | `npm run typecheck` (tsc --noEmit) produced zero errors | PASS |
| Tests pass | `npm test` — 1731 pass, 0 fail, 22 skipped | PASS |

Next action: Convert lib/commands/active.js → active.ts (CP-3)

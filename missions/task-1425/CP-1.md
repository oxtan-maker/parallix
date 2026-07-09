# CP-1: Define the module split and establish the facade

## Summary

Created the four target internal module boundaries under `lib/core/mission-utils/`
(`paths.ts`, `worktree.ts`, `graphify.ts`, `merge-noise.ts`) and converted
`lib/core/mission-utils.ts` into a pure facade that re-exports the combined public
surface from those modules via named `export { ... } from './mission-utils/*.js'`
statements. No implementation logic remains in `lib/core/mission-utils.ts` itself.
`.gitignore` was extended with `lib/core/mission-utils/*.js` so the CommonJS build
output for the new subdirectory is excluded the same way the rest of `lib/core/*.js`
already is.

The external import path used by every caller (`../core/mission-utils.js` /
`./core/mission-utils.js`) is unchanged — only the facade file's internal contents
changed from implementations to re-exports.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `lib/core/mission-utils.ts` remains in place as stable entrypoint | `lib/core/mission-utils.ts:1` | PASS |
| Facade re-exports required symbols (`findMissionDir`, `resolveWorktree`, `getPrimaryBranch`, etc.) | `lib/core/mission-utils.ts:8` (paths re-exports), `lib/core/mission-utils.ts:34` (worktree re-exports) | PASS |
| At least four focused internal module boundaries created | `lib/core/mission-utils/paths.ts:1`, `lib/core/mission-utils/worktree.ts:1`, `lib/core/mission-utils/graphify.ts:1`, `lib/core/mission-utils/merge-noise.ts:1` | PASS |
| Existing behavior unchanged through the facade | `node --test test/mission-utils.test.js` (41/41 passing, unchanged from pre-refactor) | PASS |
| No newly introduced typecheck/lint failures | `npm run typecheck`, `npx eslint lib/core/mission-utils.ts lib/core/mission-utils/*.ts` (both clean) | PASS |

Next action: extract mission path/document and branch/worktree helper implementations into `paths.ts`/`worktree.ts` per CP-2 (already staged in this pass — document and re-verify in CP-2).

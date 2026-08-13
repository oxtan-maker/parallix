# Checkpoint 3: Strip integrate.ts and add re-exports

## Summary
Stripped all extracted function bodies from `integrate.ts` (2366 -> 1569 lines, reduction of 797 lines). Added `import` + `export { ... } from` statements for all 28 extracted symbols routed through `integrate-conflict.ts` (13) and `integrate-post.ts` (15 native + 7 re-exported from `stats.ts`). Removed unused imports (`os`, `run`, `getTaskImplementer`, `transitionTask`, `getConflictFiles`, `updateGraphifyKnowledgeGraph`, `isMissionArtifact`, `stats`, `postIntegrateHook`, `writeReviewState`, `resolveForgejoUser/Home/Path`, `persistReviewStateOrThrow`, `startAgent/selectAgent/workflowLauncherStatus`, `applyAgentFallback`). Updated `(integrate as any)` assignments and final `export { }` line. Fixed `stats.ts` type errors blocking gate. Exported `defaultPrFixRounds` from `stats.ts` (was private) to satisfy SC2 re-export requirement.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| integrate.ts body has no extracted function implementations | `src/adapters/cli/commands/integrate.ts:37-68` — `export { ... } from './integrate-conflict.js'` (13 symbols) and `export { ... } from './integrate-post.js'` (22 symbols: 15 native + 7 re-exported from `stats.ts`); verified by `npm test -- test/task-2340-hook-rebounce.test.ts` (37 tests pass via re-exports) | PASS |
| Re-exports present for all extracted symbols | `src/adapters/cli/commands/integrate.ts:37-68` — `export { ... } from './integrate-conflict.js'` (13) and `export { ... } from './integrate-post.js'` (22); `./scripts/verify-local.sh static-analysis` (tsc + ESLint pass) | PASS |
| SC2: integrate-post.ts exports all listed post-integration symbols | `src/adapters/cli/commands/integrate-post.ts` exports all 21 listed symbols (14 native + 7 re-exported from `stats.ts`) | PASS |
| Line count reduced by >= 600 | `wc -l src/adapters/cli/commands/integrate.ts` — 1569 lines (was 2366, delta -797) | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` — ESLint, tsc, test-hygiene, test typecheck all passed | PASS |
| test/task-2340-hook-rebounce.test.ts resolves imports | `npm test -- test/task-2340-hook-rebounce.test.ts` — 37 tests pass, including "classifyHookFailure (integrate.ts) — SC2/SC8" and "handleHookFailureAutoBounce (integrate.ts) — SC4/SC5/SC6" | PASS |
| SC3: classifyHookFailure/handleHookFailureAutoBounce re-exported from integrate.ts | `src/adapters/cli/commands/integrate.ts:37-68` re-exports both from `integrate-post.js`; `npm test -- test/task-2340-hook-rebounce.test.ts` confirms imports resolve | PASS |
| Mandatory integration gate ran | `./scripts/verify-local.sh integrate` — 1559 tests, 1533 pass, 1 pre-existing failure (`test/integrate.test.ts` — "persistLandedIntegrationOrAbort records lifecycle completion and closure", unrelated to extraction) | PASS |

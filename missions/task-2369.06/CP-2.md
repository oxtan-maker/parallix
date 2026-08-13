# Checkpoint 2: Create integrate-post.ts

## Summary
Created `src/adapters/cli/commands/integrate-post.ts` with 15 post-integration exports: `IntegrationAbort` (class), `classifyHookFailure`, `handleHookFailureAutoBounce`, `SYNC_MERGED_DIAGNOSTICS`, `printDiagnosticTable`, `reportSyncMergedFailure`, `formatRecordedStatsRow`, `shellQuote`, `resolveForgejoUserForIntegration`, `isNoMergeToAbortResult`, `recordPostIntegrationStats`, `recordPostIntegrationStatsOrAbort`, `persistLandedIntegrationOrAbort`, `runPostIntegrateHookOrAbort`, `cleanupMissionWorktree`. Also fixed pre-existing `stats.ts` type errors (`rest.store`/`rest.dbPath` casts, `nullableNumeric` param type) that blocked the static-analysis gate.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| integrate-post.ts exists with post-integration functions/constants | `src/adapters/cli/commands/integrate-post.ts` — 15 exports (14 functions/constants + IntegrationAbort class) | PASS |
| classifyHookFailure and handleHookFailureAutoBounce present | `src/adapters/cli/commands/integrate-post.ts` lines 33 and 70 | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` — all 4 stages passed | PASS |

Next action: Strip extracted functions from integrate.ts body and add re-exports (CP-3).

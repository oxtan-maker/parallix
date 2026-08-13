# Checkpoint 1: Create integrate-conflict.ts

## Summary
Created `src/adapters/cli/commands/integrate-conflict.ts` with 13 conflict-resolution functions extracted from `integrate.ts`. File imports `IntegrationAbort` and `shellQuote` from `integrate-post.ts` (created in CP-2). Minor import path fix applied: switched `IntegrationAbort`/`shellQuote` import from `./integrate.js` to `./integrate-post.js`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| integrate-conflict.ts exists with conflict-resolution functions | `src/adapters/cli/commands/integrate-conflict.ts` — 13 exports: resolveConflictsForMission, buildConflictResolutionPrompt, rewriteWorktreePaths, stashMainCheckoutIfNeeded, restoreMainCheckoutStash, getUnresolvedIndexConflicts, areAllBacklogOnlyConflicts, parseStashPopCollisionFiles, reportStashPopFailure, findExistingSquashCommit, prepareNoisePatchForSquash, restoreNoisePatchAfterSquash, maybeUpdateGraphifyOnPrimary | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` — all stages passed | PASS |

Next action: Create integrate-post.ts with post-integration functions (CP-2).

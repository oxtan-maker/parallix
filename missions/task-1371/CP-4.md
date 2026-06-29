# CP-4: Convert lib/commands/integrate.js → integrate.ts

## Summary

Converted `lib/commands/integrate.js` (1673 lines, ~100 named exports) to `lib/commands/integrate.ts`. This is the single largest file in the codebase. Conversion uses `export =` with `IntegrateFn` interface to preserve all ~35 named exports as properties of the default `integrate` function. Added TypeScript type interface and fixed 10 type errors (null/undefined safety, unknown catch variables, implicit any).

Exports preserved: `integrate`, `resolveConflictsForMission`, `cleanupMissionWorktree`, `rewriteWorktreePaths`, `finalizeVariantACloseout`, `isNoMergeToAbortResult`, `buildConflictResolutionPrompt`, `VARIANT_B_AUTOMATION_SUMMARY`, `stashMainCheckoutIfNeeded`, `restoreMainCheckoutStash`, `evaluateTaskStatusForIntegration`, `promoteTaskForIntegrationIfNeeded`, `findExistingSquashCommit`, `printIntegrationPreflight`, `resolveForgejoUserForIntegration`, `getUnresolvedIndexConflicts`, `parseStashPopCollisionFiles`, `reportStashPopFailure`, `maybeUpdateGraphifyOnPrimary`, `SYNC_MERGED_DIAGNOSTICS`, `printDiagnosticTable`, `reportSyncMergedFailure`, `recordPostIntegrationStats`, `recordPostIntegrationStatsOrAbort`, `formatRecordedStatsRow`, `detectChangedAreas`, `parseFilesToAreas`, `loadIntegrationConfig`, `getIntegrationGatePlan`, `printIntegrationGatePlan`, `buildIntegrationGateEnv`, `resolveIntegrationVerificationWorktree`, `buildIntegrationVerificationInvocation`, `executeIntegrationGates`, `buildIntegrationContext`, `getPrimaryWorktree`.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| No CJS requires | `grep -rc 'require(' lib/commands/integrate.ts` returns exit code 1 (zero matches) — `lib/commands/integrate.ts:0` |
| No CJS exports | `grep -rc 'module\.exports' lib/commands/integrate.ts` returns exit code 1 (zero matches) — `lib/commands/integrate.ts:0` |
| Rename detection | `git diff -M --summary $(git merge-base HEAD origin/main) -- lib/commands/integrate.js lib/commands/integrate.ts` → `rename lib/commands/{integrate.js => integrate.ts} (82%)` ≥ 50% |
| Compiled output | `npm run build:cjs` generates `lib/commands/integrate.js` (83.3kB) |
| Runtime loadability | `node -e "const m = require('./lib/commands/integrate'); console.log(typeof m, typeof m.resolveConflictsForMission, typeof m.cleanupMissionWorktree)"` → `function function function` |
| Full API surface | 35 named exports attached as properties — verified by `test/integrate.test.js`, `test/integrate-guard.test.js`, `test/task-1109.test.js`, `test/task-1039-integrate.test.js` (all pass) |
| TypeScript clean | `npm run typecheck` exits with code 0 |

## Next action
Proceed to CP-5: Update `.gitignore` and `.eslintignore`.

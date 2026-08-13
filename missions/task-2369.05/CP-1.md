# CP-1: Pure gate-planning helpers extracted

## Work Summary

Mapped the helper call graph in `src/adapters/cli/commands/integrate.ts` before moving anything:

- `getIntegrationConfigPath()` is called only by `loadIntegrationConfig()` and is not part of the module's public export list.
- `detectChangedAreas()` calls `parseFilesToAreas()`; `getIntegrationGatePlan()` calls `loadIntegrationConfig()`, `detectChangedAreas()`, `orderIntegrationGates()`, and `gateMatchesChangedAreas()`.
- `isIntendedPayloadAtHead()` has one in-command call site inside `integrate()`.
- Outside consumers reach these helpers only through `integrate.js` (`test/integration-pipelines.test.ts`, `test/integrate.test.ts`) plus the `IntegrateFn` interface and the `(integrate as any).X = X` attachments at the bottom of `integrate.ts`.

Created `src/adapters/cli/commands/integrate-gates.ts` owning nine helpers moved verbatim: `getIntegrationConfigPath`, `detectChangedAreas`, `isIntendedPayloadAtHead`, `parseFilesToAreas`, `orderIntegrationGates`, `gateMatchesChangedAreas`, `loadIntegrationConfig`, `getIntegrationGatePlan`, `printIntegrationGatePlan`. `integrate.ts` now imports the eight it still uses or re-exports; `getIntegrationConfigPath` is intentionally not imported because it was never exported from `integrate.ts` and has no remaining caller there. Dependency direction is one-way (`integrate.ts` imports `integrate-gates.ts`), so no cycle is introduced.

Added focused hermetic coverage in `test/task-2369.05-integrate-gates.test.ts` with fixture `test/fixtures/task-2369.05-integration-pipelines.json`: injected git runner, fixture config path, no worktree/Forgejo/agent contact.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| New module owns the pure changed-area, config, and gate-plan helpers | `src/adapters/cli/commands/integrate-gates.ts` exports `getIntegrationConfigPath`, `detectChangedAreas`, `isIntendedPayloadAtHead`, `parseFilesToAreas`, `orderIntegrationGates`, `gateMatchesChangedAreas`, `loadIntegrationConfig`, `getIntegrationGatePlan`, `printIntegrationGatePlan` | PASS |
| `integrate.ts` holds no duplicate implementation of them | test `"integrate.ts keeps no second implementation of the extracted gate helpers"` in `test/task-2369.05-integrate-gates.test.ts` | PASS |
| Existing consumers keep their imports through `integrate.js` | test `"integrate re-exports the extracted gate helpers as the same functions integrate-gates owns"` in `test/task-2369.05-integrate-gates.test.ts` | PASS |
| Gate selection and ordering behaviour preserved | `node --import tsx --experimental-test-module-mocks --test test/integration-pipelines.test.ts` — 48 pass, 0 fail, 10 skipped (host-coupled `scripts/verify-local.sh` cases, pre-existing task-1302 skips) | PASS |
| Extraction-focused ordering/plan coverage | tests `"integrate-gates owns gate ordering with run_last gates sorted after the rest"` and `"integrate-gates plans only the gates matching the mission changed areas"` in `test/task-2369.05-integrate-gates.test.ts` | PASS |
| No new type errors from the move | `npx tsc --noEmit -p tsconfig.json` reports 5 errors, all in `src/adapters/cli/commands/stats.ts` (pre-existing, out of mission scope); none in `integrate.ts` or `integrate-gates.ts` | PASS |

Next action: move `buildIntegrationGateEnv()`, `captureFinalIntegrationTree()`, `resolveIntegrationVerificationWorktree()`, `buildIntegrationVerificationInvocation()`, and `executeIntegrationGates()` into `integrate-gates.ts`, reconnect `integrate()`'s gate block through the new imports, and extend `test/task-2369.05-integrate-gates.test.ts` with verification-worktree invocation coverage using injected `resolveWorktreeFn`/`conventionalWorktreePathFn`.

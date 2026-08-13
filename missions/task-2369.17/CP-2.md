## CP-2: Extract shared module, replace definitions with imports

### Work Done

**New file**: `src/application/hook-failure-workflow.ts` — command-neutral application module with 4 exports:
- `classifyHookFailure()` — identical to both prior copies
- `MAX_HOOK_RETRY` — value `2`
- `HookRebouncePort` — `Pick<RebaseWorkflowPort, ...>` (11 members)
- `handleHookFailureAutoBounce()` — port-based signature (canonical from rebase)

**`src/application/rebase-workflow.ts`**: Removed 135 lines of local definitions. Imports + re-exports all 4 items from `hook-failure-workflow.js`. Internal callers (`runRebaseWorkflow`) unchanged — names resolved via import.

**`src/adapters/cli/commands/integrate.ts`**: Removed 145 lines of local definitions. Two changes:
- `classifyHookFailure`: imported and re-exported from shared module (same function, zero wrapper)
- `handleHookFailureAutoBounce`: thin adapter wrapper (~30 lines) that composes adapter defaults (`startAgent`, `readReviewState`, `writeReviewState`, `transitionTask`, `applyAgentFallback`, `selectAgent`, `workflowLauncherStatus`, `resolveTaskFile`, `getTaskImplementer`) into `HookRebouncePort` and delegates to shared `handleHookFailureAutoBouncePolicy`. Preserves historical `*Fn` options bag signature for existing callers and tests.

**Import chain preserved**:
- `rebase.ts` CLI → `classifyHookFailure` from `rebase-workflow.ts` (re-exported from `hook-failure-workflow.ts`)
- `rebase.ts` CLI → `handleHookFailureAutoBounce` from `rebase-workflow-adapter.ts` (wraps policy from `rebase-workflow.ts` → `hook-failure-workflow.ts`)
- `rebase-workflow-adapter.ts` → `handleHookFailureAutoBounce as handleHookFailureAutoBouncePolicy` from `rebase-workflow.ts` (re-exported)
- `integrate.ts` → `classifyHookFailure` from `hook-failure-workflow.ts` (direct)
- `integrate.ts` → wrapper `handleHookFailureAutoBounce` delegates to `handleHookFailureAutoBouncePolicy` from `hook-failure-workflow.ts`
- `integrate-command.ts` → imports both from `integrate.ts` (unchanged)

**Net diff**: -294 lines removed, +116 lines added (net -178 lines). Zero behavior change.

### Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `hook-failure-workflow.ts` is sole definition location | `src/application/hook-failure-workflow.ts` — defines `classifyHookFailure`, `MAX_HOOK_RETRY`, `HookRebouncePort`, `handleHookFailureAutoBounce` | PASS |
| `rebase-workflow.ts` has no local definition of 4 exports | `src/application/rebase-workflow.ts` — imports + re-exports from `hook-failure-workflow.js` | PASS |
| `integrate.ts` has no local `classifyHookFailure` definition | `src/adapters/cli/commands/integrate.ts` — `import { classifyHookFailure }` from shared module | PASS |
| `integrate.ts` imports shared `handleHookFailureAutoBounce` | `src/adapters/cli/commands/integrate.ts` — wrapper delegates to `handleHookFailureAutoBouncePolicy` from shared module | PASS |
| TypeScript typecheck passes | `npx tsc --noEmit` — zero errors | PASS |

Next action: CP-3 — Verify existing tests pass, add shared-module test suite, run mission gates.

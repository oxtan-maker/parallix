## CP-1: Inspect duplicate functions and callers

### Work Done

Inspected both copies of `classifyHookFailure()` and `handleHookFailureAutoBounce()` to record callers, classification branches, auto-bounce branches, and port dependencies.

**classifyHookFailure()** — identical in both files. Same regex patterns, same return type.
- Callers in `rebase-workflow.ts`: lines 501, 515, 661 (3 sites in `runRebaseWorkflow`)
- Caller in `integrate-command.ts`: line 482 (squash commit hook path)
- Classification branches: pre-commit, pre-push, post-commit, generic `hook.*(failed|failure|error)`

**handleHookFailureAutoBounce()** — same logic, different signatures:
- Rebase: takes `port: HookRebouncePort` (port-based injection)
- Integrate: takes individual `*Fn` adapter defaults (options bag)
- Key difference: integrate uses `persistReviewStateOrThrow(writeReviewStateFn, ...)` for persist; rebase uses `port.persistReviewState(slug, state, worktree, missionStore)`
- Integrate catches agent launch error and returns `false`; rebase catches and calls `port.exit(1)`
- Both: same retry budget (`MAX_HOOK_RETRY = 2`), same prompt template, same implementer resolution

**HookRebouncePort** — `Pick<RebaseWorkflowPort, 'startAgent' | 'readReviewState' | 'writeReviewState' | 'persistReviewState' | 'exit' | 'transitionTask' | 'applyAgentFallback' | 'selectAgent' | 'workflowLauncherStatus' | 'resolveTaskFile' | 'getTaskImplementer'>`

**Import chain**:
- `rebase.ts` CLI → `classifyHookFailure` from `rebase-workflow.ts`, `handleHookFailureAutoBounce` from `rebase-workflow-adapter.ts`
- `rebase-workflow-adapter.ts` → imports `handleHookFailureAutoBounce as handleHookFailureAutoBouncePolicy` from `rebase-workflow.ts`, wraps with adapter options
- `integrate.ts` → exports both (defined locally)
- `integrate-command.ts` → imports both from `integrate.ts`

**Tests**: `test/task-2340-hook-rebounce.test.ts` — tests both versions via `rebase.ts` and `integrate.ts` exports.

### Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Two duplicate functions identified and compared | `src/application/rebase-workflow.ts` (lines 22–135), `src/adapters/cli/commands/integrate.ts` (lines 30–175) | PASS |
| Classification branches identical across copies | Both use same 4 regex patterns: pre-commit, pre-push, post-commit, generic hook | PASS |
| Auto-bounce branches compared | Same retry budget (2), same prompt, same implementer resolution; differ in persist path and error handling | PASS |
| Port members documented | `HookRebouncePort` = 11 members from `RebaseWorkflowPort` | PASS |
| Existing tests cataloged | `test/task-2340-hook-rebounce.test.ts` covers both versions | PASS |

Next action: CP-2 — Extract `src/application/hook-failure-workflow.ts` with shared exports, then update rebase and integrate imports.

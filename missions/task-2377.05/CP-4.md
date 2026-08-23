# CP-4 — the standalone bounce policy is deleted and the invariant is locked

## Summary

**Policy deleted (SC6).** `src/application/hook-failure-workflow.ts` is reduced
to `classifyHookFailure` and nothing else — it is now a zero-import module.
`handleHookFailureAutoBounce`, `MAX_HOOK_RETRY`, `HookRebouncePort`, and the
`hookFailureRetryCount` metadata read/write are gone.
`classifyHookFailure`'s behavior is byte-for-byte unchanged: the same
pre-commit / pre-push / post-commit ordering and the same narrowed generic
`hook.*(failed|failure|error)` rule that keeps paths like `post-integrate-hook.ts`
from matching.

**Wrappers and re-exports removed.**

- `src/adapters/cli/commands/integrate-post.ts`: the `handleHookFailureAutoBounce`
  adapter (its port assembly and the whole `HookRebouncePort` construction) is
  deleted, along with the now-unused `readReviewState` / `writeReviewState` /
  `persistReviewStateOrThrow`, `startAgent` / `selectAgent` /
  `workflowLauncherStatus`, `applyAgentFallback`, and
  `resolveTaskFile` / `getTaskImplementer` / `transitionTask` imports it existed
  to feed. `classifyHookFailure` is still re-exported from here. Its mock seam
  was already re-provided as kernel-context injection in CP 2.
- `src/adapters/cli/commands/integrate.ts`: the two `handleHookFailureAutoBounce`
  re-export blocks, the `IntegrateFn` type member, and the
  `(integrate as any).handleHookFailureAutoBounce` attachment are removed.
- `src/application/rebase-workflow.ts`, `src/application/ports/rebase-workflow.ts`,
  `src/adapters/rebase/rebase-workflow-adapter.ts`, `src/adapters/review/rebase.ts`,
  and `src/adapters/cli/commands/rebase.ts` lost theirs in CP 1.

`git grep -n "hookFailureRetryCount\|MAX_HOOK_RETRY\|handleHookFailureAutoBounce" src/`
now returns zero hits — including in prose: the module docstring that records the
removal deliberately describes the deleted symbols rather than naming them, so the
zero-hit search stays honest.

**Tests rewritten onto the kernel contract.**

- `test/task-2340-hook-rebounce.test.ts`: every `classifyHookFailure` assertion
  survives verbatim (the rebase, integrate, and shared-module describes, the
  non-hook-error describe, and the `Generic hook match narrowed — F7` describe
  that covers the real past `post-integrate-hook.ts` false positive), as does the
  pre-review lifecycle rebounce describe. Removed and replaced:
  - `"returns true (should retry) when under retry budget"`,
    `"returns false (stranded) when max retries exceeded"`,
    `"exports MAX_HOOK_RETRY with value 2"`,
    `"shared handleHookFailureAutoBounce works with port-based injection"`,
    `"shared handleHookFailureAutoBounce strands at max retries"`,
    `"integrate squash-commit retry path uses shared classification"` — all pinned
    the deleted `hookFailureRetryCount` metadata writes and `MAX_HOOK_RETRY`.
    Replaced by the kernel-contract cases in the new
    `Hook bounce on the rebound kernel — TASK-2377.05` describe, which cover the
    same ground against the surviving behavior: fixed-only-after-a-passing-re-run,
    exhaustion at the per-occurrence budget carrying the last re-run diagnostic,
    and a fresh budget for a second occurrence in the same process.
  - `"integrate handler prompt contains hook output text"` (deleted handler) →
    `"embeds the hook output and hook type in the fix prompt"`.
  - `"integrate handler transitions task before launch"` (deleted handler) →
    `"transitions the task to the implementer phase before launching, and pins the agent"`.
  - Added `"no longer exports the deleted auto-bounce policy"`, which asserts the
    module's export surface is exactly `['classifyHookFailure']`.
- `test/task-2369.13-bounce-output-elision.test.ts`: its hook-failure case built a
  `HookRebouncePort` for the deleted handler.
  `"stays bounded with 500 KB of hook output and keeps head+tail"` keeps its name
  and every assertion; only the call under test moved to `rebound()`. The elision
  contract itself is unchanged — the kernel's one fix-prompt builder runs the same
  `elideBounceOutput`.
- `test/review-state.test.ts` needed no edit: its
  `assert.equal(read.metadata.hookFailureRetryCount, undefined)` already asserted
  the counter's absence and still passes.

**Invariant locked (SC7).** `test/task-2377.05-kernel-only-bounce.test.ts` scans
every `.ts` file under `src/` for `startAgent` / `startAgentFn` calls, attributes
each to its enclosing file-level symbol, and fails on anything outside a written
allow-list. It cites `<file>::<symbol>` pairs only — no line numbers — so edits
above a call site cannot rot it. The allow-list holds the launcher itself and its
draft wrapper, the `px active` initial execute launch and its agent-family
fallback, the review-loop reviewer/implementer round launches together with the
timeout re-poll relaunches TASK-2377.04 deliberately left outside the kernel, the
two conflict-resolution launches, the kernel's own `launchFixAttempt` port, and
`attemptAgentRelaunch`.

`attemptAgentRelaunch` is **not** on that list — it was deleted (CP 3), along
with its one remaining caller's dependency on it. The allow-list therefore
contains no failure-repair launch except the kernel's own `launchFixAttempt`,
which `"SC7: the kernel launch port is present and is the only failure-repair
launch"` asserts. Two launch *ports* the kernel drives are listed —
`reboundLaunchPort` inside `runHandoffAndReview`, and the `startAgent` wiring in
`createHandoffPorts` — and a separate test,
`"SC7: the handoff launch lives inside the kernel launch-port adapter, not in the
bounce logic"`, pins the former to the adapter so a future direct launch in the
surrounding bounce logic cannot ride in on that entry.

The guard was checked for falsifiability, not just green: adding a rogue
`startAgentFn('act-on-review', …)` to `repair-handoff.ts` failed both the
allow-list test and the SC8 test; reverting made them pass again.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC5/SC6 the standalone policy and its persisted counter are gone from `src/` | `git grep -n "hookFailureRetryCount" src/`, `git grep -n "MAX_HOOK_RETRY" src/`, and `git grep -n "handleHookFailureAutoBounce" src/` (0 hits each); `"SC5/SC6: the deleted standalone bounce policy leaves no trace in src/"` in `test/task-2377.05-kernel-only-bounce.test.ts` | PASS |
| SC6 `hook-failure-workflow.ts` exports `classifyHookFailure` and nothing else | `"SC6: hook-failure-workflow exports only the hook detector"` in `test/task-2377.05-kernel-only-bounce.test.ts`; `"no longer exports the deleted auto-bounce policy"` in `test/task-2340-hook-rebounce.test.ts` | PASS |
| SC6 `classifyHookFailure` behavior unchanged, including the no-false-positive rule | surviving describes `"classifyHookFailure (rebase.ts) — SC1/SC7"`, `"classifyHookFailure (integrate.ts) — SC2/SC8"`, `"Generic hook match narrowed — F7"` in `test/task-2340-hook-rebounce.test.ts` (assertions unchanged) | PASS |
| SC6 wrappers and re-exports removed from `integrate-post.ts` and `integrate.ts` | `git grep -n "handleHookFailureAutoBounce" src/adapters/cli/commands/` (0 hits); `npx eslint src/` (no unused-import fallout) | PASS |
| SC5 nothing is persisted; the budget is per occurrence and in memory | `"strands after the per-occurrence budget without persisting a counter"`, `"starts a second occurrence in the same process from a full budget"` in `test/task-2340-hook-rebounce.test.ts`; `ADR 0053` (persistence authority boundary) | PASS |
| SC7 the allow-list names every permitted launch and fails on any other | `"SC7: no agent launch outside the rebound kernel except the enumerated allow-list"` in `test/task-2377.05-kernel-only-bounce.test.ts`; cites `<file>::<symbol>` pairs, no line numbers | PASS |
| SC7 no failure-repair launch exists outside the kernel — no exceptions remain | `git grep -n "attemptAgentRelaunch" src/` (0 hits); `"SC7: the handoff launch lives inside the kernel launch-port adapter, not in the bounce logic"` in `test/task-2377.05-kernel-only-bounce.test.ts` | PASS |
| SC7 the guard is falsifiable, not vacuously green | a probe `startAgentFn('act-on-review', …)` appended to `src/adapters/cli/commands/repair-handoff.ts` failed the allow-list and SC8 tests; `git checkout -- src/adapters/cli/commands/repair-handoff.ts` restored green | PASS |
| SC7 the kernel is the only failure-repair launch path | `"SC7: the kernel launch port is present and is the only failure-repair launch"` in `test/task-2377.05-kernel-only-bounce.test.ts`; `ADR 0048` (the one dispatch table, unchanged) | PASS |
| SC8 the git-only repair path is still agent-less | `"SC8: the git-only handoff repair path launches no agent"` in `test/task-2377.05-kernel-only-bounce.test.ts`; `git diff --stat src/adapters/cli/commands/repair-handoff.ts` (empty) | PASS |
| Rewritten and adjacent suites green | `npm test -- test/task-2340-hook-rebounce.test.ts test/task-2369.13-bounce-output-elision.test.ts test/task-2377.05-kernel-only-bounce.test.ts test/review-state.test.ts test/rebase-use-case.test.ts test/integrate.test.ts test/integrate-workflow-gate.test.ts test/post-integrate-hook.test.ts test/task-2377.05-integrate-squash-bounce.test.ts` (152 tests, 0 fail) | PASS |
| Lint and typecheck clean across `src/` | `npm run typecheck`; `npx eslint src/` | PASS |

Next action: CP 5 — run `./scripts/verify-local.sh all` and
`./scripts/verify-local.sh docs` on the final tree, update the `docs/agents.md`
"Pre-review bounce policy" section per SC11, and write the final Goal Check table
covering SC1–SC12.

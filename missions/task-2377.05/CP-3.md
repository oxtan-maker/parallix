# CP-3 — `px active` handoff bounces on the rebound kernel

## Summary

Both relaunch loops in `runHandoffAndReview` (`src/adapters/cli/commands/active.ts`)
and the `isRelaunchableError` fallback relaunch now run through the rebound
kernel. `git grep -n "maxRelaunches\|maxCheckpointRelaunches" src/` returns only
the two comments that record the removal — no loop remains.

**Checkpoint-validation bounce (SC3).** The `maxCheckpointRelaunches = 2`
while-loop is replaced by one `rebound()` call whose `verify` re-runs the exact
check that failed, `validateCheckpointsBeforeHandoffFn(slug, worktree, { log,
error })`, and reports `ok` on its `ok`. `fixed` falls through to
`performHandoff`; `exhausted` / `human-only` re-read the final validation state
and emit `checkpointValidationNextAction` before returning false, as today. The
relaunchability decision stays exactly where it was — the
`validation.nextCheckpoint || IncompleteEvidence` guard — so a non-relaunchable
checkpoint error never reaches the kernel and launches nothing.

*Classifier fix (ADR 0048 class 4).* Wiring this site exposed a real bug rather
than a spec conflict. `validateCheckpointsBeforeHandoff` emits
`"Declared checkpoint documents are missing before handoff: CP-2, …"` when an
agent ends its turn without writing the checkpoints its own mission declared.
That text matched **no** pattern in `src/application/failure-classification.ts`
and fell through to the catch-all `InfraBlocker` / `HumanOnly` default — so the
kernel refused to bounce and the mission stranded on manual instructions, even
though one relaunch naming the gap is exactly the repair. That is agent
hallucination, not infrastructure. ADR 0048 already prescribes the right answer
in class 4 ("Incomplete checkpoint evidence — **Auto-send-back**"); only the
classifier's pattern list was missing it. Rule `1d` was added beside the three
existing IncompleteEvidence checkpoint rules, so the site passes
`{ kind: 'handoff-verification', error }` exactly as SC3 specifies and the
kernel now classifies it `IncompleteEvidence` / `AutoSendBack`. No ADR text
changed — the dispatch table and the eight classes are untouched; a new pattern
was mapped onto an existing class. `src/application/failure-classification.ts`
was listed as a restricted area for this mission; the edit is a deliberate,
operator-approved override of that restriction, made because the restriction
would otherwise have preserved a stranding bug.

**Handoff-failure bounce (SC4).** The `maxRelaunches = 2` while-loop is replaced
by one `rebound({ kind: 'handoff-verification', error: handoffResult.error,
gateOutput })` call. The captured gate output is flattened by a new
`flattenGateOutput` helper into the kernel's `gateOutput` slot, so it reaches the
fix prompt on the first attempt (later attempts carry the fresher verify
diagnostic, by kernel design). `verify` re-runs
`_performHandoff(slug, { forgejoUser: agent, worktree, force: true })`, assigns
the result to `handoffResult`, and returns `ok` on `handoffResult.ok` — so the
refreshed result flows into the gatekeeper-pushback and review-loop branches
below. On `exhausted` the existing `Gate failure persisting after N relaunch
attempts. Manual intervention required.` message is set, now sourced from
`DEFAULT_REBOUND_ATTEMPTS`. The existing guard
(`dispatchAction !== 'HumanOnly' && failureClass !== 'GitBlockers'`) is unchanged,
so `HumanOnly` and `GitBlockers` still take the `repairHandoffFn` branch without
launching anything.

**Fallback relaunch (SC4).** The `isRelaunchableError` fallback inside the
`repairHandoffFn` branch is routed through the kernel with the same re-run-
`performHandoff` verify; its `Post-relaunch handoff failed: …` message is kept.

**`attemptAgentRelaunch` resolution: deleted.** It is gone from
`src/adapters/cli/commands/active.ts` together with its export. Its
responsibilities were split to where they belong: the relaunchability decision
and the retry budget moved to the kernel, and what is genuinely launcher-side —
the `workflowLauncherStatus` availability check and the resume-aware
`startAgent` call — is now a small local `reboundLaunchPort` adapter that the
kernel drives and that decides nothing. `runHandoffAndReview` takes
`startAgentFn` and `workflowLauncherStatusFn` as its injected seams in place of
`attemptAgentRelaunchFn`.

Deleting it required migrating its one remaining caller, the gatekeeper-pushback
remediation (`remediateGatekeeperPushback` in
`src/application/handoff-command-use-case.ts`), which the mission had listed as
out of scope. That is a deliberate, operator-approved scope extension taken so
AC #3 holds literally rather than by exception. The `while (retriesLeft > 0)`
loop there is now a `rebound()` call with `kind: 'artifact-incomplete'` carrying
the missing-artifact list, and a `verify` that re-runs `performHandoff`. The
recursion guard is preserved exactly: the kernel gets `maxAttempts: 1` per level
because the retry budget is spent by the recursion into `performHandoff`
(decrementing `remainingRetries`), not by the kernel looping — the same two total
launches the old loop made. A spent budget (`retriesLeft <= 0`) strands without
launching, as the old `while` condition did. `HandoffAgentRelaunchPort` is
replaced by `HandoffAgentLaunchPort` (`startAgent`), wired from
`src/adapters/cli/commands/handoff.ts`.

**SC8.** `src/adapters/cli/commands/repair-handoff.ts` is unedited
(`git diff --stat` on it is empty) and contains zero agent launches.

Changed expectations (both from SC5's per-occurrence budget: the kernel spends 2
attempts per occurrence and a *failed launch* consumes an attempt instead of
aborting the bounce, where the old local loops broke out immediately):

- `"runHandoffAndReview: relaunch failure must not trigger post-relaunch handoff"`
  (`test/active.test.ts`) — relaunch count 1 → 2. `performHandoff` is still called
  exactly once, because the kernel's verify only runs after a successful launch,
  so the assertion the test is named for is unchanged.
- `"missing checkpoint: relaunch failure returns false with manual instruction"`
  (`test/task-2261-checkpoint-gates-repro.test.ts`) — relaunch count 1 → 2. The
  return value, the zero `performHandoff` calls, and the manual instruction are
  unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3 the `maxCheckpointRelaunches` loop is gone and the path calls `rebound()` with a re-validate verify | `git grep -n "maxCheckpointRelaunches" src/` (only the removal comment); `rebound({ kind: 'handoff-verification', error })` in `src/adapters/cli/commands/active.ts` | PASS |
| SC3 re-validation passes → falls through to `performHandoff` | `"SC3: checkpoint re-validation passing falls through to performHandoff"` in `test/task-2377.05-handoff-bounce.test.ts` | PASS |
| SC3 two failed re-validations → false after exactly two launches, `checkpointValidationNextAction` emitted | `"SC3: two failed re-validations return false after exactly two launches"` in `test/task-2377.05-handoff-bounce.test.ts` | PASS |
| SC3 a non-relaunchable checkpoint error launches no agent | `"SC3: a non-relaunchable checkpoint error launches no agent at all"` in `test/task-2377.05-handoff-bounce.test.ts` | PASS |
| A declared checkpoint gap is classified as agent hallucination, not infrastructure | `"a declared checkpoint gap classifies as IncompleteEvidence, not InfraBlocker"` in `test/task-2377.05-handoff-bounce.test.ts`; `ADR 0048` class 4 ("Incomplete checkpoint evidence — Auto-send-back") | PASS |
| The gap now bounces and the mission continues instead of stranding | `"a declared checkpoint gap bounces and continues once the agent writes the checkpoints"` in `test/task-2377.05-handoff-bounce.test.ts` | PASS |
| The new classifier rule does not reclassify real infrastructure blockers | `"the new rule does not reclassify real infrastructure blockers"` in `test/task-2377.05-handoff-bounce.test.ts`; `ADR 0048` classes 7 and 8 unchanged | PASS |
| SC4 the `maxRelaunches` loop is gone; `rebound()` carries `gateOutput` and verifies with `performHandoff` | `git grep -n "maxRelaunches" src/` (only the removal comment); `"SC4: the kernel carries the captured gate output into the bounce"` in `test/task-2377.05-handoff-bounce.test.ts` | PASS |
| SC4 verify-pass → the refreshed `handoffResult` reaches the gatekeeper-pushback branch | `"SC4: a passing performHandoff re-run flows into the gatekeeper-pushback branch"` in `test/task-2377.05-handoff-bounce.test.ts` | PASS |
| SC4 two failed re-runs → exactly two launches and the automated-handoff-failed path | `"SC4: two failed performHandoff re-runs give exactly two launches and the failure path"` in `test/task-2377.05-handoff-bounce.test.ts` | PASS |
| SC4 `HumanOnly` / `GitBlockers` launch no agent and take the `repairHandoffFn` branch | `"SC4: a HumanOnly classification launches no agent and takes the repairHandoffFn branch"`, `"SC4/SC8: a GitBlockers classification takes the git-only repair branch, agent-less"` in `test/task-2377.05-handoff-bounce.test.ts` | PASS |
| SC5 per-occurrence budget: a second occurrence starts full, nothing persisted | `"SC5: a second handoff occurrence in one process starts from a full budget of two"` in `test/task-2377.05-handoff-bounce.test.ts`; `ADR 0053` | PASS |
| SC8 `repair-handoff.ts` unedited and agent-less | `git diff --stat src/adapters/cli/commands/repair-handoff.ts` (empty); `git grep -n "startAgent" src/adapters/cli/commands/repair-handoff.ts` (0 hits); `npm test -- test/repair-handoff.test.ts test/task-2202-repair-handoff-autocommit.test.ts` | PASS |
| `attemptAgentRelaunch` is deleted, with no remaining caller | `git grep -n "attemptAgentRelaunch" src/` (0 hits); `"SC7: the handoff launch lives inside the kernel launch-port adapter, not in the bounce logic"` in `test/task-2377.05-kernel-only-bounce.test.ts` | PASS |
| Gatekeeper pushback bounces through the kernel with its recursion guard intact | `"performHandoff respects bounded retry limit of 2 for gatekeeper pushback"`, `"performHandoff consumes full retry budget when relaunch succeeds but pushback persists"`, `"performHandoff relaunch prompt lists all missing artifact types"` in `test/handoff.test.ts` | PASS |
| The launcher-availability check survives the deletion | `"the launch port declines when the agent launcher is unavailable"` in `test/active.test.ts` | PASS |
| The checkpoint continuation contract survives the deletion | `"the checkpoint bounce prompt names the next checkpoint and forbids an early exit"` in `test/active.test.ts` | PASS |
| CP 3 named suites green | `npm test -- test/handoff.test.ts test/handoff-use-case.test.ts test/repair-handoff.test.ts test/task-2202-repair-handoff-autocommit.test.ts` (0 fail) | PASS |
| Adjacent handoff suites green with the two justified expectation edits | `npm test -- test/active.test.ts test/task-2261-checkpoint-gates-repro.test.ts test/task-1039-handoff.test.ts test/task-1124-integrate.test.ts` (284 tests with the CP 3 suites, 0 fail) | PASS |
| SC3/SC4 suite green | `npm test -- test/task-2377.05-handoff-bounce.test.ts` (9 tests, 0 fail) | PASS |
| Lint and typecheck clean on changed files | `npm run typecheck`; `npx eslint src/adapters/cli/commands/active.ts test/task-2377.05-handoff-bounce.test.ts` | PASS |

Next action: CP 4 — delete `handleHookFailureAutoBounce`, `MAX_HOOK_RETRY`,
`HookRebouncePort`, and the `hookFailureRetryCount` metadata read/write from
`src/application/hook-failure-workflow.ts` plus every re-export and wrapper,
rewrite `test/task-2340-hook-rebounce.test.ts` onto the kernel contract keeping
its `classifyHookFailure` assertions verbatim, and add
`test/task-2377.05-kernel-only-bounce.test.ts` with the allow-list that names the
gatekeeper-pushback relaunch as its out-of-scope exception.

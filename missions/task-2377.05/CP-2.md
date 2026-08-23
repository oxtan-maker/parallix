# CP-2 — `px integrate` squash-commit bounce on the rebound kernel

## Summary

The squash-commit hook bounce in `px integrate` now runs through the rebound
kernel (`src/application/rebound-kernel.ts`) instead of the standalone policy.

- `src/adapters/cli/commands/integrate.ts`: the `while (commitResult.status !== 0)`
  bounce loop is gone. The site now makes one `rebound({ kind: 'hook-failure',
  hook, operation: 'squash commit', output }, …)` call whose `verify` re-runs the
  identical `git commit --only -m "<branch>: <summary>" -- <intendedPayloadPaths>`
  invocation and reports `ok` only when that exits 0. `fixed` falls through to
  the existing `Squash commit created after hook fix.` / `rev-parse HEAD` success
  path; `exhausted` / `human-only` take the existing stranded path — the
  `Fix the reported hook failure in <worktree> and retry integrate.` operator hint
  followed by `IntegrationAbort`.
- Preserved unchanged: the `isIntendedPayloadAtHead` already-landed
  short-circuit (now the first branch of the `if`, reached before any bounce),
  and the non-hook-failure branch, which still emits the verification-command
  hint and throws `IntegrationAbort` without launching anything.
- Mock seam re-provided as kernel-context injection: `integrate()`'s options
  object gained `startAgentFn`, `transitionTaskFn`, `applyAgentFallbackFn`,
  `selectAgentFn`, and `workflowLauncherStatusFn` — the same five seams
  `integrate-post.ts`'s wrapper provided — and they are wired straight into the
  kernel context's `startAgent` / `transitionToImplementer` /
  `applyAgentFallback` slots. Integrate tests keep a mock launch/transition/
  fallback port and never reach a real agent, git, or Forgejo. `integrate-post.ts`'s
  wrapper and the shared policy itself are deleted in CP 4, per the mission's
  checkpoint split.
- If no resolver can name an implementer (`context.taskAssignee`,
  `selectAgentFn`, `workflowLauncherStatusFn` all empty) the site strands with
  the operator hint rather than launching with an empty agent identity — the
  deleted policy's behavior.

Budget semantics follow SC5: the kernel's in-memory per-occurrence budget of 2
(`DEFAULT_REBOUND_ATTEMPTS`), no counter written anywhere.

SC9 (dead duplicate integrate implementation) verified, not repaired: TASK-2372
already consolidated it. `src/adapters/cli/commands/integrate-command.ts` does
not exist, `git grep -n "integrate-command\." src/ test/` returns zero hits, and
`src/application/integrate-command-use-case.ts` has its two live callers. No
shim was found, so nothing was deleted.

New tests (`test/task-2377.05-integrate-squash-bounce.test.ts`, mock-only —
git/Forgejo/worktree boundaries doubled, kernel launch seams injected):

- S1 fixed path: hook failure → one launch → passing re-run commit → integration
  lands.
- S2 exhausted path: two failed re-run commits → exactly two launches →
  `IntegrationAbort` (exit 1) with the operator hint still emitted.
- S3 the `isIntendedPayloadAtHead` short-circuit takes the already-landed path
  with zero launches.
- S4 a non-hook commit failure aborts with zero launches.

No expectation in an existing named suite changed for CP 2.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2 squash-commit hook failure routes through the kernel with a re-run-the-commit verify | `rebound({ kind: 'hook-failure', … operation: 'squash commit' })` in `src/adapters/cli/commands/integrate.ts`; `git grep -n "while (commitResult.status" src/adapters/cli/commands/integrate.ts` (0 hits) | PASS |
| SC2 fixed path: re-run commit exits 0 → integration lands | `"SC2 S1: hook failure bounces through the kernel and lands when the re-run commit passes"` in `test/task-2377.05-integrate-squash-bounce.test.ts` | PASS |
| SC2 exhausted path: two failed re-runs → `IntegrationAbort` with the existing operator hint | `"SC2 S2: two failed re-run commits exhaust the budget and throw IntegrationAbort"` in `test/task-2377.05-integrate-squash-bounce.test.ts` | PASS |
| SC2 `isIntendedPayloadAtHead` already-landed short-circuit unchanged | `"SC2 S3: an already-landed payload short-circuits without bouncing"` in `test/task-2377.05-integrate-squash-bounce.test.ts` | PASS |
| SC2 non-hook-failure abort branch unchanged | `"SC2 S4: a non-hook commit failure aborts without bouncing"` in `test/task-2377.05-integrate-squash-bounce.test.ts` | PASS |
| SC5 per-occurrence in-memory budget of 2, nothing persisted at this site | exactly two launches asserted in `"SC2 S2: two failed re-run commits exhaust the budget and throw IntegrationAbort"`; `ADR 0053` (persistence authority boundary) | PASS |
| Mock seam preserved — no test launches a real agent, git, or Forgejo | `startAgentFn` / `transitionTaskFn` / `applyAgentFallbackFn` / `selectAgentFn` / `workflowLauncherStatusFn` options in `src/adapters/cli/commands/integrate.ts`, all injected in `test/task-2377.05-integrate-squash-bounce.test.ts` | PASS |
| SC9 no dead duplicate integrate implementation | `git grep -n "integrate-command\." src/ test/` (0 hits), `src/application/integrate-command-use-case.ts` with callers `src/composition/create-cli.ts` and `src/interfaces/cli/integrate.ts` | PASS |
| CP 2 named suites green | `npm test -- test/integrate-workflow-gate.test.ts test/post-integrate-hook.test.ts test/integrate.test.ts` (82 tests, 0 fail) | PASS |
| SC2 suite green | `npm test -- test/task-2377.05-integrate-squash-bounce.test.ts` (4 tests, 0 fail) | PASS |
| Lint and typecheck clean on changed files | `npm run typecheck`; `npx eslint src/adapters/cli/commands/integrate.ts test/task-2377.05-integrate-squash-bounce.test.ts` | PASS |

Next action: CP 3 — migrate both relaunch loops in `runHandoffAndReview`
(`src/adapters/cli/commands/active.ts`) to `rebound()` with re-validate-checkpoints
and re-run-`performHandoff` verifies, route the `isRelaunchableError` fallback
relaunch through the kernel, resolve `attemptAgentRelaunch` to either a kernel
launch adapter or deletion, and confirm `repair-handoff.ts` is unedited and
agent-less.

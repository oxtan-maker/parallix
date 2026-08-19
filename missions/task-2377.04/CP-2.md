# CP-2 (STOP): timeout bounces cannot reach the kernel under the TASK-2377.03 contract

## Summary

CP-2 asks that the reviewer poll-timeout and implementer disposition-timeout relaunches
in `src/adapters/review/review-loop.ts` become
`rebound({ kind: 'agent-timeout', role, diagnostic }, …)` calls whose verify callback
re-polls, so that `fixed` requires a non-timeout re-poll (SC3).

That is not reachable with the kernel as TASK-2377.03 shipped it, and the mission's first
stop rule covers exactly this case:

> The kernel or a classifier would need a contract change to wire a path → stop; this
> mission consumes the TASK-2377.03 contract as-is.

**The conflict.** `classifyReboundReason` in `src/application/rebound-kernel.ts` maps
`agent-timeout` **unconditionally** to `FailureClass.InfraBlocker` /
`DispatchAction.HumanOnly` — there is no diagnostic-based escape (the
`hasExplicitHumanOnlyDiagnostic` branch only exists for `gate-failure`, `hook-failure`,
and `artifact-incomplete`). `rebound()` returns early for a non-relaunchable
classification: outcome `human-only`, `attempts: 0`, **zero launches, verify never
called**. Routing the timeout paths through `rebound()` as written would therefore
delete the two bounded recovery relaunches these paths perform today and replace them
with an immediate human escalation — a behavior regression, and SC3's "same shape as
SC2" (relaunch → re-verify → strand) would be unsatisfiable.

Making it work requires `agent-timeout` to become relaunchable in
`classifyReboundReason` — i.e. a change to a Restricted Area (`rebound-kernel.ts`,
`failure-classification.ts`), to ADR 0048 classification semantics, and to a pinned
kernel test. Three stop rules point the same way, so CP-2 is not being guessed at.

**Not done, deliberately:** no timeout path was migrated, and the
`reviewerRetryCount` / `implementerRetryCount` while-loops they use are left intact and
behavior-identical. The only CP-1 change touching that region removed the redundant
third `dispatchArtifactFailure` call inside the implementer timeout loop (see CP-1);
the loop's own bound and control flow are unchanged.

## Decision needed before CP-2 can proceed

Pick one, then re-run this mission (or a successor) with it written into the mission:

1. **Amend the kernel contract** (new mission or an explicit scope widening here):
   `agent-timeout` classifies as relaunchable (e.g. `IncompleteEvidence` /
   `AutoSendBack`, or a new class) with human-only reserved for the *exhausted*
   outcome, matching what the review loop does today (2 recovery relaunches, then
   `REVIEWER_NON_APPROVAL`). `test/task-2377.03-rebound-kernel.test.ts` —
   `"task-2377.03: an agent-timeout reason classifies as an InfraBlocker human-only
   failure"` and `"task-2377.03: a human-only classification returns human-only without
   launching an agent"` — must be re-pinned with it.
2. **Keep the contract and rescope CP-2**: timeout recovery stays a review-loop
   concern; only its persisted counters are deleted (in-memory round-local counters),
   and SC1/SC3 are narrowed to the artifact + gate/hook paths.

Option 1 matches the mission's Goal ("every review-loop agent relaunch is
verify-gated"); option 2 matches the Restricted Areas. The choice is a contract call,
not an implementation detail.

## Also blocking this session

`git commit` cannot run here: the worktree `/home/magnus/code/parallix-task-2377.04` is
read-write, but its git directory `/home/magnus/code/parallix/.git/worktrees/
parallix-task-2377.04` is on a read-only mount (`mount` reports
`/home/.ecryptfs/magnus/.Private on /home/magnus type ecryptfs (ro,…)`), so
`git add` fails with `index.lock: Read-only file system` — with and without the
sandbox. CP-1's code changes and both checkpoint documents are therefore present in the
working tree but **uncommitted**, and the mission's handoff precondition ("do not hand
off to review if MISSION.md or checkpoint documents are uncommitted") cannot be met from
this session.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3 (timeout bounces verify-gated) | Blocked by contract: `src/application/rebound-kernel.ts` `classifyReboundReason` returns `InfraBlocker`/`HumanOnly` for every `agent-timeout` reason, and `rebound()` returns before its launch loop when `classification.isRelaunchable` is false. Pinned by `test/task-2377.03-rebound-kernel.test.ts` — `"task-2377.03: an agent-timeout reason classifies as an InfraBlocker human-only failure"` and `"task-2377.03: a human-only classification returns human-only without launching an agent"` (asserts `launches === 0` for `{ kind: 'agent-timeout' }`) | Blocked — mission stop rule 1 |
| SC8 (preserved behavior unchanged) | Timeout recovery left untouched: `npm test -- test/task-2233-reviewer-non-submission-bounce.test.ts test/task-2317-context-compaction.test.ts test/review.test.ts test/task-2373-needs-you.test.ts` → 133 pass / 0 fail, including `"recovery loop should complete 2 retries before escalation"` assertions and the `RECOVERY: Reviewer timeout` / `RECOVERY: Implementer disposition timeout` prompt-shape checks in `test/task-2317-context-compaction.test.ts` | Met (nothing regressed) |
| CP-1 still green under the stop | `npm test -- test/review-artifact-dispatcher.test.ts test/review-artifacts.test.ts test/task-1268-pre-review-gate-per-round.test.ts test/task-1383-active-gate-failure-prompt.test.ts test/task-2377.03-rebound-kernel.test.ts`; `npx tsc --noEmit -p tsconfig.json` exits 0 | Met |
| Stop rule applied rather than guessed | Mission stop rules 1 ("kernel or classifier contract change → stop") and 8 ("any change would alter `ADR 0048` classification semantics → stop"); Restricted Areas list `src/application/rebound-kernel.ts` and `src/application/failure-classification.ts` as read-only | Met |
| Commits blocked (external) | `git add` / `git commit` fail with `fatal: Unable to create '/home/magnus/code/parallix/.git/worktrees/parallix-task-2377.04/index.lock': Read-only file system`, sandbox disabled; `mount` shows `/home/magnus` mounted `ro` while only the mission worktree is `rw` | Blocked — external |

Next action: decide between amending the `agent-timeout` classification in the rebound
kernel (option 1, needs a scope widening or a follow-up task since
`src/application/rebound-kernel.ts` is a Restricted Area here) and rescoping SC1/SC3 to
the artifact + gate/hook paths (option 2); and restore write access to
`/home/magnus/code/parallix/.git` so CP-1's changes and these checkpoints can be
committed.

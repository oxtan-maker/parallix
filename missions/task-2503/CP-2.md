# CP-2: Capture the implementer at the rebase boundary from the mission record

## Summary

`runRebaseWorkflow` in `src/application/rebase-workflow.ts` now captures the
mission's recorded implementer at the rebase boundary from the **mission
record** (`port.readReviewState`) and only falls back to the Backlog task file.
The review state is not part of the history being replayed, so a stale mission
branch can no longer expose an older assignee to conflict recovery. The captured
value is the single source used by shared-file conflict recovery and by the hook
bounce, exactly as before — no new call sites, no change to initial implementer
assignment, Forgejo transport, or unrelated rebase flows.

An unreadable mission record is caught and treated as local metadata
unavailability (fall through to the task file); when neither source resolves,
the existing local-workflow diagnostic — "No recorded implementer for
<slug>; cannot launch conflict resolution." plus the assignee remediation — is
emitted. That message is classified `StateMachineViolation` by ADR 0048's
dispatch table (`src/application/failure-classification.ts`), not
`InfraBlocker`, so it is never reported as a Forgejo or network blocker.

The CP-1 reproduction is now green.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Recorded implementer A is captured before commit replay and survives replayed metadata | `npm test -- test/task-2503-repro.test.ts` — test name "shared-file rebase recovery dispatches the implementer recorded before commit replay" passes (task file exposes `qwen`/`vibe`, launch carries `claude`) | Passing |
| Shared-file conflict recovery dispatches recorded implementer A | Same test asserts `step === 'conflict-resolution'`, `options.agent === 'claude'`, `role === 'implementer'`, `pinnedAgent === true` | Passing |
| Local metadata unavailability reported as a local workflow condition, no Forgejo/network attribution | Test name "unavailable local mission metadata is reported as a local workflow condition, not an infrastructure blocker" in `test/task-2503-repro.test.ts`; ADR 0048 dispatch rule for "no recorded implementer … cannot launch conflict resolution" in `src/application/failure-classification.ts` maps it to `StateMachineViolation` | Passing |
| No regression in existing rebase behaviour | `npm test -- test/rebase.test.ts test/rebase-use-case.test.ts test/rebase_hardening.test.ts test/rebase_diagnostics.test.ts test/task-2377-02-pre-review-rebase-inprocess.test.ts` — 76 tests pass, 0 fail | Passing |
| `./scripts/verify-local.sh all` exits successfully | Deferred to CP-3 (repository gate) | Pending CP-3 |

Next action: run the mission gate `./scripts/verify-local.sh all` on the
committed tree and record the completed goal check in CP-3.

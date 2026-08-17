# CP-2: Launch, verify loop, and per-occurrence budget

## Summary

- Completed the kernel's attempt loop in `src/application/rebound-kernel.ts`: for each attempt it builds the fix prompt from the current diagnostic, optionally transitions the task back to the implementer phase, launches through the injected `startAgent` port, then runs `verify()`. Verify pass → `fixed`; verify fail with budget left → relaunch with the fresh diagnostic; budget spent → `exhausted` carrying the last diagnostic (the caller strands).
- `launchFixAttempt()` reclassifies an ambiguous exit as launch failure: `result.status === null` (or a missing result) and a thrown launch both produce a failed attempt with a diagnostic, consume one unit of budget, and skip `verify()` entirely — a null-exit "fix" can never be reported as `fixed`. A non-zero exit is likewise a failed attempt.
- Budget is per `rebound()` invocation: a local `for` loop bounded by `maxAttempts` (default `DEFAULT_REBOUND_ATTEMPTS = 2`). There is no counter read, no counter write, and no state-store slot anywhere in `ReboundContext`, so two processes cannot share or split one budget (the task-2369.13 split-brain failure mode) and a later occurrence of the same failure class always starts at attempt 1.
- Diagnostic freshness: the prompt for attempt *n+1* is built from the diagnostic the verify re-run returned, not from the original failure text.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2 — `fixed` only after `verify` passes | `test/task-2377.03-rebound-kernel.test.ts`: `"task-2377.03: an outcome of fixed is returned only after verify passes"` | PASS |
| SC2 — a failing verify consumes one attempt and relaunches with the fresh diagnostic | `"task-2377.03: a failing verify consumes one attempt and relaunches with the fresh diagnostic"` | PASS |
| SC2 — two failed verifies exhaust the budget, carry the last diagnostic, and make no third launch | `"task-2377.03: two failed verifies exhaust the default budget with the last diagnostic and no third launch"` | PASS |
| SC3 — budget is in-memory per invocation, default 2; a later occurrence starts fresh | `src/application/rebound-kernel.ts` (`DEFAULT_REBOUND_ATTEMPTS`); `"task-2377.03: the budget is per occurrence — a second invocation after an exhausted one starts fresh"`, `"task-2377.03: the budget is configurable per occurrence and never read from persisted state"` | PASS |
| SC3 — zero review-state metadata writes and zero SQLite writes from the kernel | `"task-2377.03: the kernel writes nothing to a state store while spending a whole budget"` (store whose every write method throws; the run spends the full budget and touches none) | PASS |
| SC4 — a null/ambiguous exit is a launch failure, never `fixed`, and consumes budget | `"task-2377.03: an ambiguous null agent exit is a launch failure, never fixed, and consumes budget"`, `"task-2377.03: a null-exit first attempt still allows a verified fix inside the same budget"`, `"task-2377.03: a throwing launch is a failed attempt, not a fix"` | PASS |
| Kernel returns the fallback-resolved implementer and drives the implementer-phase transition through injected callbacks | `"task-2377.03: the kernel returns the fallback-resolved implementer and moves the task to the implementer phase"` | PASS |
| Kernel suite is mock-only and green | `npm test -- test/task-2377.03-rebound-kernel.test.ts` → 22 pass, 0 fail | PASS |

Known environment blocker (not a code issue): the worktree's Git metadata directory `/home/magnus/code/parallix/.git/worktrees/parallix-task-2377.03` is on a read-only mount in this session, so `git add`/`git commit` fail with `index.lock: Read-only file system`. CP-1 and CP-2 content is written to the worktree and re-verified by the commands cited above; commits are retried at each subsequent checkpoint.

Next action: CP 3 — route the pre-review gate path and the pre-review Git-hook path in `src/adapters/review/review-loop.ts` / `src/adapters/review/review-gate-handling.ts` through `rebound()`, delete the synthesized `git-hook` `PreReviewGateResult` remap and the GitBlockers relabel, give the hook path a `verify` that re-runs the in-process pre-review rebase plus the verification gate, and re-run `npm test -- test/task-2353-rebounce-reproduction.test.ts test/task-1268-pre-review-gate-per-round.test.ts test/task-1383-active-gate-failure-prompt.test.ts test/task-1385-pre-review-gate.test.ts`.

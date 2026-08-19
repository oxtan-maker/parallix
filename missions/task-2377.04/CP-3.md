# CP-3: Per-round relaunch cap

## Summary

Implemented the in-memory per-round relaunch cap in `src/adapters/review/review-loop.ts` and the
new mock-only tests for SC4 and SC7.

**What landed:**

- `DEFAULT_REBOUNDS_PER_ROUND = 6` (named exported constant) and the injectable
  `reboundsPerRound` option on `startReviewLoop` (`src/adapters/review/review-loop.ts:55-58,65,139`).
- The new named escalation reason `REBOUNDS_PER_ROUND_EXHAUSTED`
  (`src/adapters/review/review-loop.ts:58`), delivered through the existing
  `escalateToHumanReview` path (persists `humanEscalationReason`, fires `onAutonomousStop`).
- A round-local counter `reboundsUsedThisRound` declared before the round loop and reset to 0 at
  the top of every round iteration — in-memory only, never persisted (ADR 0053: the kernel's
  per-occurrence budget stays the only retry state; the cap adds no persistence either).
- **Clamp + accounting at every rebound-kernel call site** (pre-review rebase hook failure,
  pre-review gate failure, reviewer artifact failure, implementer artifact failure): before the
  call, the per-occurrence `maxAttempts` is clamped to
  `Math.min(<per-occurrence default>, remaining round budget)`; after the call, the kernel's
  `outcome.attempts` are added to the round counter. `ReboundPreReviewResult` in
  `src/adapters/review/review-gate-handling.ts` now exposes `attempts` so the loop can account
  for gate/hook occurrences exactly as for artifact occurrences.
- **Exhaustion diagnostic with the new reason:** when the round budget is exhausted, the loop
  stops with an explicit log line (`Per-round relaunch cap reached for <slug>: N/M relaunches
  used in round R; no further <context> relaunches.`) plus
  `escalateToHumanReview(REBOUNDS_PER_ROUND_EXHAUSTED)`, and performs no further relaunches.
  This fires (a) before a rebound call when the remaining budget is 0, and (b) after an
  occurrence that exhausted exactly the remaining budget — in case (b) the new cap reason
  replaces the per-kind strand reason; below the cap the per-kind reasons
  (`REVIEWER_ARTIFACT_RETRY_EXHAUSTED`, `IMPLEMENTER_ARTIFACT_RETRY_EXHAUSTED`, gate/hook
  `exit(1)`) are unchanged.
- **Timeout-recovery relaunches count against the cap too.** The two loop-local
  timeout-recovery while-loops (kept loop-local by the CP-2 stop — the kernel classifies
  `agent-timeout` as non-relaunchable under the TASK-2377.03 contract, and CP-2 option 2 is the
  rescope this mission now runs under) check the cap before each relaunch and add one unit to
  the round counter per relaunch; a cap-exhausted loop stops with the same diagnostic and the
  new named reason instead of continuing into its own bound or the per-kind escalation.

**Behavior at the default cap (6):** none of the four named suites changes until six bounce
launches accumulate in one round; the clamp is identity below that, so prompts, budgets, and
strand reasons are byte-identical for every scenario under the cap.

**Tests:** new `test/task-2377.04-per-round-rebound-cap.test.ts` — mock-only, four tests. The
rebound kernel runs for real inside the loop (it is the code under test); the launch port,
artifact re-consumption, polling, state persistence, and every other collaborator are injected.
No agents, no git, no Forgejo.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4 — named constant, default 6, injectable | `DEFAULT_REBOUNDS_PER_ROUND` and `REBOUNDS_PER_ROUND_EXHAUSTED` exported from `src/adapters/review/review-loop.ts:55-58`; `reboundsPerRound` option at `src/adapters/review/review-loop.ts:65,139`; asserted by `"task-2377.04: a round reaching the per-round relaunch cap stops with the cap diagnostic and exactly the capped number of bounce launches (SC4)"` in `test/task-2377.04-per-round-rebound-cap.test.ts` | Met |
| SC4 — round hitting the cap stops with the diagnostic and exactly the capped number of launches | Same test: cap 3, a fixed artifact occurrence (2 launches) plus one timeout-recovery relaunch stops the loop at exactly 3 bounce launches; asserts the `Per-round relaunch cap reached` log line, `onAutonomousStop` called with `REBOUNDS_PER_ROUND_EXHAUSTED`, and zero implementer launches after the cap. Run: `npm test -- test/task-2377.04-per-round-rebound-cap.test.ts` | Met |
| SC4 — a round under the cap is unaffected | `"task-2377.04: a round under the per-round cap is unaffected and keeps the per-kind exhaustion reason (SC4)"`: default cap (option omitted), artifact occurrence keeps its full budget of 2 and strands on `REVIEWER_ARTIFACT_RETRY_EXHAUSTED` with no cap diagnostic | Met |
| SC4 — counter resets per round | `"task-2377.04: the per-round relaunch counter resets when the next round starts (SC4)"`: cap 3, round 1 spends 2 (fixed bounce), round 2's occurrence still gets 2 full launches and strands on the per-kind reason — with a non-resetting counter it would clamp to 1 launch and fire the cap reason | Met |
| SC7 — fresh per-occurrence budget after an exhausted occurrence | `"task-2377.04: an exhausted artifact occurrence gets a fresh per-occurrence budget on the next occurrence (SC7)"`: run 1 exhausts the artifact budget (2 relaunches, strand); run 2 resumes on the persisted round and the same-kind occurrence again gets a fresh budget of 2 — no cumulative carryover from persisted counters; kernel contract pinned by `test/task-2377.03-rebound-kernel.test.ts` — `"task-2377.03: the budget is per occurrence — a second invocation after an exhausted one starts fresh"` | Met |
| SC1 — bounce launches route through the kernel (as rescoped by CP-2) | `git grep -n startAgentFn src/adapters/review/review-loop.ts src/adapters/review/review-artifacts.ts`: remaining direct `startAgentFn` launch sites are the two per-round first launches (`review-loop.ts:645` reviewer, `review-loop.ts:935` implementer — not bounces), the two loop-local timeout-recovery relaunches (`review-loop.ts:794`, `review-loop.ts:1072` — kept loop-local by the CP-2 stop, now cap-checked), and the kernel launch-port closures (`review-loop.ts:707`, `review-loop.ts:993` feed `startAgent` to `rebound()` via `dispatchArtifactFailure`); `review-artifacts.ts:803-827` holds the port only, no direct launch. All four artifact/gate/hook bounce paths relaunch only through the kernel; paired test: `test/task-2377.04-per-round-rebound-cap.test.ts` (kernel launch port injected, bounce launches counted through it) | Met (rescoped per CP-2 stop: timeout relaunches stay loop-local, see CP-2.md option 2) |
| No dual persistence (SC9 contribution) | The cap counter is a round-local variable in `src/adapters/review/review-loop.ts` (reset per round, never written to review state, metadata, or SQLite); the kernel's zero-state-writes contract is pinned by `test/task-2377.03-rebound-kernel.test.ts` — `"task-2377.03: the kernel writes nothing to a state store while spending a whole budget"` | Met |
| No regression | `npm test -- test/review-artifact-dispatcher.test.ts test/review-artifacts.test.ts test/task-1268-pre-review-gate-per-round.test.ts test/task-1383-active-gate-failure-prompt.test.ts test/task-2377.03-rebound-kernel.test.ts test/review.test.ts test/task-2317-context-compaction.test.ts test/task-2233-reviewer-non-submission-bounce.test.ts test/task-2373-needs-you.test.ts` → 245 pass / 0 fail; `./scripts/verify-local.sh all` → 1936 pass / 0 fail, exit 0 (includes the preserved max-attempts, gatekeeper pushback, and stale BLOCKED/PARKED paths; one ledger citation in `src/application/consumer-domain-requirements.ts` re-pointed from `review-loop.ts:48` to `review-loop.ts:60` because the new exported constants shifted line numbers — anchor and requirement unchanged) | Met |

Next action: CP-4 — delete the persisted retry state: remove the `reviewerRetryCount` /
`implementerRetryCount` ReviewState fields (switching the two timeout-recovery loops to
in-memory round-local counters), the `reviewerArtifactRetryCount` /
`implementerArtifactRetryCount` metadata-key remnants, the mapping sync, the
`gateFailureRetryCount` / `hookFailureRetryCount` domain fields and the orphaned
`recordGateFailureRetry` / `recordHookFailureRetry` / `recordReviewRetry` methods, the
`mission_reviews` column reads/writes, the new drop migration 0016, and the removed-field log
lines in `review-commands.ts`.

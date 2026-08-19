# CP-5: Full verification and docs

## Summary

Final checkpoint. The `docs/agents.md` "Pre-review bounce policy" section is rewritten for
the end state, both mission gates pass on the final tree, and the mission-wide Goal Check
over SC1–SC10 is below.

**What landed:**

- **`docs/agents.md` — "Pre-review bounce policy — verified fixes and a per-failure budget"**
  rewritten from two guarantees to three:
  1. The bounce scope now names incomplete artifacts alongside gate and hook failures, and
     the verified-fix rule spells out what re-runs per kind: the pre-review rebase and the
     verification gate for gate/hook failures, a fresh re-consumption of the role's
     artifacts for an incomplete-artifact failure (CP-1).
  2. The per-occurrence budget paragraph now states explicitly that **no retry counter is
     written to review state, to its metadata, or to the database** — the CP-4 deletion,
     stated rather than implied.
  3. A new third guarantee documents the per-round relaunch cap: six by default, the
     occurrence budget clamped to the remaining round budget, cap diagnostic plus human
     escalation on exhaustion, in-memory, reset per round (CP-3).
- A closing paragraph states truthfully that **agent-timeout recovery is not on the
  verified-fix path**: the classifier treats a timeout as an infrastructure blocker, which
  is not relaunchable, so timeout recovery remains a bounded review-loop relaunch that
  re-polls — and that those relaunches still count against the per-round cap. This is the
  CP-2 stop written into the docs rather than papered over; SC10's literal wording asks the
  section to say timeout bounces are verify-gated, and saying so would be false on this tree.
- No `file.ts:<line>` citation was introduced (the docs gate rejects them in authored docs).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — bounce/relaunch paths route through `rebound()` | `git grep -n "startAgentFn(" src/adapters/review/review-loop.ts src/adapters/review/review-artifacts.ts` → four sites: the two per-round **first launches** (reviewer `'review'`, implementer `'act-on-review'`), which SC1 permits, and the two **timeout-recovery** relaunches kept loop-local by the CP-2 stop. Zero direct launches remain on the artifact paths; both artifact bounces relaunch only through the kernel-injected launch port inside `dispatchArtifactFailure`. Proven by `"dispatchArtifactFailure relaunches with the fresh diagnostic when the re-consume still fails"` (`test/review-artifact-dispatcher.test.ts`) and by the cap tests counting bounce launches through the injected port in `test/task-2377.04-per-round-rebound-cap.test.ts` | Met for artifact + gate/hook; **rescoped** for timeout paths — see CP-2.md |
| SC2 — artifact bounces verify-gated | `test/review-artifact-dispatcher.test.ts`: `"dispatchArtifactFailure reports fixed only when the re-consumed reviewer artifacts are complete"` (re-consume pass → `fixed`), `"dispatchArtifactFailure relaunches with the fresh diagnostic when the re-consume still fails"` (re-consume fail → relaunch with the fresh diagnostic), `"dispatchArtifactFailure strands with the last diagnostic when the occurrence budget is spent"` (two failures → no third launch), `"dispatchArtifactFailure refuses to run without a verify callback"`, `"dispatchArtifactFailure routes the implementer role through the kernel with its own diagnostic"` | Met |
| SC3 — timeout bounces verify-gated | **Not done — mission stop rule 1.** `classifyReboundReason` in `src/application/rebound-kernel.ts` maps `agent-timeout` unconditionally to `InfraBlocker`/`HumanOnly`, and `rebound()` returns before its launch loop for a non-relaunchable classification: zero launches, verify never called. Pinned by `"task-2377.03: an agent-timeout reason classifies as an InfraBlocker human-only failure"` and `"task-2377.03: a human-only classification returns human-only without launching an agent"` (`test/task-2377.03-rebound-kernel.test.ts`). Routing the timeout paths through `rebound()` as written would delete two working bounded relaunches and replace them with an immediate human escalation. Making it work needs a contract change to `src/application/rebound-kernel.ts` / `src/application/failure-classification.ts` — both Restricted Areas here — and to `ADR 0048` classification semantics, which stop rules 1 and 8 both forbid. Full analysis and the two decision options are in `missions/task-2377.04/CP-2.md` | **Blocked — stop rule 1** |
| SC4 — per-round cap | `DEFAULT_REBOUNDS_PER_ROUND` (6) and `REBOUNDS_PER_ROUND_EXHAUSTED` exported from `src/adapters/review/review-loop.ts`, injectable via the `reboundsPerRound` option. `test/task-2377.04-per-round-rebound-cap.test.ts`: `"task-2377.04: a round reaching the per-round relaunch cap stops with the cap diagnostic and exactly the capped number of bounce launches (SC4)"`, `"task-2377.04: a round under the per-round cap is unaffected and keeps the per-kind exhaustion reason (SC4)"`, `"task-2377.04: the per-round relaunch counter resets when the next round starts (SC4)"`. The default 6 was never adjusted — the clamp is identity below the cap, so the four named suites are unaffected | Met |
| SC5 — review-state fields and metadata keys deleted | `git grep -n "reviewerArtifactRetryCount\|implementerArtifactRetryCount" -- src/` → zero; `git grep -n "reviewerRetryCount\|implementerRetryCount" -- src/adapters/review/review-state.ts` → zero. `"ReviewState toJSON includes metadata when present (TASK-2377.04: no retry counts serialize)"` (`test/review-state.test.ts`), `"advanceRound increments round and resets phase/disposition (TASK-2377.04: retry counts are loop-local)"` (`test/review-state-class.test.ts`). Surviving hits are the protected `mission_review_rounds` round fields and the Restricted-Area `src/application/hook-failure-workflow.ts` (TASK-2377.05's CLI/handoff path) — documented in `missions/task-2377.04/CP-4.md` | Met as scoped (see CP-4.md note) |
| SC6 — SQLite + domain deleted | `src/adapters/sqlite/migrations/0016-review-drop-retry-counters.sql`; `npm test -- test/task-2377.04-drop-retry-counters-migration.test.ts` → 5 pass / 0 fail, covering `"runs on a pre-existing 0015-or-older database: columns absent afterwards, other review data survives"`, `"applies on a fresh database: mission_reviews never carries the retry columns"`, `"mission round-trips (store serialize → reload) without the removed fields; historical round counts stay"`. `git grep -n "recordGateFailureRetry\|recordHookFailureRetry\|recordReviewRetry" -- src/` → zero | Met |
| SC7 — fresh per-occurrence budget | `"task-2377.04: an exhausted artifact occurrence gets a fresh per-occurrence budget on the next occurrence (SC7)"` (`test/task-2377.04-per-round-rebound-cap.test.ts`) and `"dispatchArtifactFailure gives every occurrence a fresh budget (no persisted carryover)"` (`test/review-artifact-dispatcher.test.ts`); kernel contract pinned by `"task-2377.03: the budget is per occurrence — a second invocation after an exhausted one starts fresh"` (`test/task-2377.03-rebound-kernel.test.ts`) | Met |
| SC8 — surviving behavior + named suites green | `npm test -- test/review-artifact-dispatcher.test.ts test/review-artifacts.test.ts test/task-1268-pre-review-gate-per-round.test.ts test/task-1383-active-gate-failure-prompt.test.ts test/task-2377.03-rebound-kernel.test.ts test/task-2377.04-per-round-rebound-cap.test.ts` → 116 pass / 0 fail. The max-attempts cap and `MAX_ATTEMPTS` escalation, the gatekeeper pushback path, and the stale BLOCKED/PARKED disposition-recovery path are unmodified across CP-1…CP-5; the timeout-recovery bound stays 2 with `REVIEWER_NON_APPROVAL` as its escalation, asserted by the three repro tests in `test/task-2233-reviewer-non-submission-bounce.test.ts` and the recovery-prompt shape checks in `test/task-2317-context-compaction.test.ts`. Every changed expectation is justified per test name in `missions/task-2377.04/CP-1.md` and `missions/task-2377.04/CP-4.md` | Met |
| SC9 — no dual persistence | `"dispatchArtifactFailure persists no retry state anywhere"` (`test/review-artifact-dispatcher.test.ts`), `"startReviewLoop performs recovery relaunches without persisting any retry count"` and `"startReviewLoop performs the implementer recovery relaunch without persisting any retry count"` (`test/review.test.ts`), `"task-2377.03: the kernel writes nothing to a state store while spending a whole budget"` (`test/task-2377.03-rebound-kernel.test.ts`), plus the SC5/SC6 code searches. `ADR 0053`: the kernel's in-memory per-occurrence budget is the only retry state the review loop has | Met |
| SC10 — gate + docs | `./scripts/verify-local.sh all` → exit 0, 1941 pass / 0 fail on the final tree; `./scripts/verify-local.sh docs` → exit 0 (`PASS: authored documentation contains no volatile implementation evidence and relative links resolve`). `docs/agents.md` "Pre-review bounce policy" states the verified-fix rule for artifact bounces, that no persisted retry counter remains, and that the per-round relaunch cap exists | Met for the gates and for two of the three doc claims; the third — "timeout bounces are verify-gated" — is **not** claimed, because SC3 is blocked and the sentence would be false. The section instead states the true timeout behavior |
| ADR alignment | `ADR 0048` classification semantics consumed unchanged (no classifier edit anywhere in the diff); `ADR 0053` persistence-authority boundary advanced by deleting the review loop's last retry writes | Met |

## Unfinished at mission end

1. **SC3 (timeout bounces onto the kernel)** — stopped under mission stop rule 1, decision
   options in `missions/task-2377.04/CP-2.md`. Requires either a kernel-contract amendment
   making `agent-timeout` relaunchable (a new task, since `src/application/rebound-kernel.ts`
   is a Restricted Area here) or an explicit rescope of SC1/SC3 to the artifact + gate/hook
   paths. The timeout paths were left behavior-identical apart from CP-3's cap check and
   CP-4's swap of their persisted counters for round-local in-memory ones.
2. *(cleared)* **Committing CP-4 and CP-5** — was blocked by a read-only mount on
   `/home/magnus/code/parallix/.git`. The mount is writable again and both checkpoints are
   committed (`483bd1a89`, `94da863c1`).

Next action: take the SC3 contract decision from
`missions/task-2377.04/CP-2.md` — amend `agent-timeout` classification in a follow-up task, or
rescope SC1/SC3 to the artifact + gate/hook paths and close TASK-2377.04 as delivered.

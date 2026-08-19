# CP-1: Artifact bounces onto the rebound kernel

## Summary

Both review-loop artifact-failure bounce paths — reviewer and implementer — now run
through the rebound kernel (`src/application/rebound-kernel.ts`, TASK-2377.03) with a
verify callback that **re-consumes** the role's artifacts. A relaunch alone no longer
counts as recovery: the occurrence is reported `fixed` only when the re-consumed
artifacts come back complete and ok.

Work done:

1. **`src/adapters/review/review-artifacts.ts` — `dispatchArtifactFailure` rewritten**
   as the artifact-path kernel adapter (the same shape as `reboundPreReviewFailure`
   in `src/adapters/review/review-gate-handling.ts`). It builds the structured
   `{ kind: 'artifact-incomplete', role, diagnostic }` reason and hands the kernel a
   verify callback, a role-shaped launch port, and an agent-fallback port. It reads
   and writes **no** state.
   - Deleted: `MAX_ARTIFACT_RETRY`, `REVIEWER_ARTIFACT_RETRY_KEY`
     (`reviewerArtifactRetryCount`), `IMPLEMENTER_ARTIFACT_RETRY_KEY`
     (`implementerArtifactRetryCount`), the persisted read/increment/strand-marker
     writes, and the in-memory `state.metadata` sync.
   - New exported constant `ARTIFACT_REBOUND_ATTEMPTS` (= the kernel's
     `DEFAULT_REBOUND_ATTEMPTS`, 2), per occurrence and in-memory.
   - Result type changed from `{ action: 'relaunch' | 'strand', retryCount, maxRetries,
     metadata }` to `{ action: 'fixed' | 'strand' | 'human-only', attempts, maxAttempts,
     agent, diagnostic, role }`.
2. **`src/adapters/review/review-loop.ts` — reviewer artifact-failure path** replaced
   its "dispatch → relaunch → set `reviewState = POLL_TIMEOUT`" block with one
   `dispatchArtifactFailure('reviewer', …)` occurrence. The launch port wraps
   `startAgentFn('review', …)` so the kernel's fix prompt is appended to the compact
   review prompt (role `reviewer`, `exclude: [implementer]`, `onAgentLaunched` intact);
   the verify callback re-runs `consumeReviewerArtifactsFn` and only passes on
   `consumed && ok`. On `fixed` the loop takes the re-consumed `reviewState`; otherwise
   it escalates (`REVIEWER_ARTIFACT_RETRY_EXHAUSTED`, or
   `REVIEWER_ARTIFACT_INFRA_FAILURE` for a `human-only` classification).
3. **`src/adapters/review/review-loop.ts` — implementer artifact-failure path** replaced
   the nested relaunch → re-consume → second-dispatch ladder (~75 lines) with one
   occurrence through the kernel, verify = `consumeImplementerArtifactsFn`. On `fixed`
   the loop takes the re-consumed disposition; otherwise it escalates
   (`IMPLEMENTER_ARTIFACT_RETRY_EXHAUSTED` / `IMPLEMENTER_ARTIFACT_INFRA_FAILURE`).
4. The third `dispatchArtifactFailure` call, inside the implementer **timeout**-recovery
   while-loop, was removed rather than migrated: that loop already bounds its own
   relaunches, so re-entering the dispatcher there would spend a second budget for one
   timeout occurrence. It now logs the incomplete-artifact diagnostic and falls through
   to the poll exactly as before. The timeout loop itself is CP-2 work.

### Changed expectations in a named suite (`test/review-artifact-dispatcher.test.ts`)

Every deleted assertion targeted the *persisted cumulative* budget that this mission
removes; the dispatcher's consume-side tests are untouched.

| Old test name | Why it was replaced |
|---|---|
| `"dispatchArtifactFailure returns relaunch for reviewer on first failure"` | Asserted `action === 'relaunch'` and `metadata.reviewerArtifactRetryCount === 1` — the persisted counter and the unverified "relaunch" outcome both no longer exist. Replaced by `"dispatchArtifactFailure reports fixed only when the re-consumed reviewer artifacts are complete"`. |
| `"dispatchArtifactFailure returns strand for reviewer after max retries"` / `"…for implementer after max retries"` | Seeded a persisted retry count of 2 to force a strand — the kernel budget cannot be seeded from disk. Replaced by `"dispatchArtifactFailure strands with the last diagnostic when the occurrence budget is spent"`. |
| `"dispatchArtifactFailure returns relaunch for implementer on first failure"` | Same persisted-counter assertion; replaced by `"dispatchArtifactFailure routes the implementer role through the kernel with its own diagnostic"`. |
| `"reviewer and implementer artifact retry counters are independent"`, `"stranded state records actionable metadata for reviewer"`, `"…for implementer"`, `"dispatchArtifactFailure uses separate metadata keys from gate retry counters"`, `"dispatchArtifactFailure handles null persisted state"`, `"dispatchArtifactFailure respects custom maxRetries"`, `"dispatchArtifactFailure syncs retry count into in-memory state on relaunch"`, `"dispatchArtifactFailure syncs strand markers into in-memory state"`, `"dispatchArtifactFailure returns metadata in result"`, `"dispatchArtifactFailure skips state sync when state is null"`, `"dispatchArtifactFailure skips state sync when state has no metadata"` | All assert on review-state metadata keys, strand markers, or the metadata-sync contract — the whole persistence surface deleted by this mission. Their replacement guarantee is `"dispatchArtifactFailure persists no retry state anywhere"`, which fails if any write reappears. |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 (partial — artifact bounces route through `rebound()`) | `git grep -n "startAgentFn" src/adapters/review/review-loop.ts src/adapters/review/review-artifacts.ts` shows the two first-launch sites plus the two kernel-injected launch ports inside the `dispatchArtifactFailure(...)` calls; the ports are only reachable from `rebound()`. `test/review-artifact-dispatcher.test.ts` — `"dispatchArtifactFailure relaunches with the fresh diagnostic when the re-consume still fails"` proves the relaunch happens through the kernel-injected port. Timeout paths are CP-2. | Partial (artifact half done) |
| SC2 (artifact bounces verify-gated) | `npm test -- test/review-artifact-dispatcher.test.ts` — `"dispatchArtifactFailure reports fixed only when the re-consumed reviewer artifacts are complete"` (re-consume pass → `fixed`), `"dispatchArtifactFailure relaunches with the fresh diagnostic when the re-consume still fails"` (re-consume fail → relaunch, fresh diagnostic in prompt), `"dispatchArtifactFailure strands with the last diagnostic when the occurrence budget is spent"` (2 launches, no third), `"dispatchArtifactFailure refuses to run without a verify callback"` | Met |
| SC7 (fresh per-occurrence budget) | `test/review-artifact-dispatcher.test.ts` — `"dispatchArtifactFailure gives every occurrence a fresh budget (no persisted carryover)"`; kernel contract pinned by `test/task-2377.03-rebound-kernel.test.ts` — `"task-2377.03: the budget is per occurrence — a second invocation after an exhausted one starts fresh"` | Met for the artifact path |
| SC9 (no dual persistence on the artifact path) | `test/review-artifact-dispatcher.test.ts` — `"dispatchArtifactFailure persists no retry state anywhere"`; `git grep -n "reviewerArtifactRetryCount\|implementerArtifactRetryCount" src/` now matches only `src/adapters/review/review-state.ts` (the reset-side deletes, removed in CP-4) | Met for the dispatcher |
| SC8 (named suites green) | `npm test -- test/review-artifacts.test.ts test/task-1268-pre-review-gate-per-round.test.ts test/task-1383-active-gate-failure-prompt.test.ts test/task-2377.03-rebound-kernel.test.ts` → 91 pass / 0 fail; `npm test -- test/review-artifact-dispatcher.test.ts` → 21 pass / 0 fail | Met |
| No regression in adjacent review behavior | `npm test -- test/review.test.ts test/task-2373-needs-you.test.ts test/task-2233-reviewer-non-submission-bounce.test.ts test/task-2317-context-compaction.test.ts` → 133 pass / 0 fail (covers the max-attempts cap, gatekeeper pushback, and the reviewer/implementer timeout loops preserved for CP-2) | Met |
| Typecheck clean on the changed tree | `npx tsc --noEmit -p tsconfig.json` → no output (exit 0); `npx eslint src/adapters/review/review-loop.ts src/adapters/review/review-artifacts.ts` → no findings (the remaining `curly` findings are baseline, in the untouched consume-side head of `test/review-artifact-dispatcher.test.ts`, which the gate's `eslint … src/` scope does not lint) | Met |
| Mission gates on the CP-1 tree | `./scripts/verify-local.sh all` → exit 0 (1932 tests, 0 fail); `./scripts/verify-local.sh docs` → exit 0 (`PASS: authored documentation contains no volatile implementation evidence and relative links resolve`) | Met |
| ADR alignment | `ADR 0048` classification is consumed unchanged (`artifact-incomplete` → IncompleteEvidence / AutoSendBack, asserted by `test/task-2377.03-rebound-kernel.test.ts`); `ADR 0053` persistence-authority boundary advanced by deleting the dispatcher's review-state writes | Met |

Next action: CP-2 — migrate the reviewer poll-timeout and implementer disposition-timeout
relaunches in `src/adapters/review/review-loop.ts` onto `rebound()` with `agent-timeout`
reasons, first resolving whether the kernel's unconditional
`agent-timeout → InfraBlocker/HumanOnly` classification (pinned by
`test/task-2377.03-rebound-kernel.test.ts` — `"task-2377.03: an agent-timeout reason
classifies as an InfraBlocker human-only failure"`) permits a relaunch at all, since a
`human-only` outcome launches nothing.

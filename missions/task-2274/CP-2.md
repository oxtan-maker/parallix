# CP-2: Role-Owned Artifact Recovery Dispatcher

## Summary

Added `dispatchArtifactFailure()` dispatcher in `review-artifacts.ts` and integrated all scoped artifact-failure paths in `review-loop.ts`. Reviewer and implementer artifact failures now route to their respective producing roles with captured diagnostics, persisted per-role retry counters, and stranded state on exhaustion. HumanOnly classifications for infrastructure and task-state failures remain terminal via ADR 0048 `classifyError()`.

### Changes

**`src/adapters/review/review-artifacts.ts`:**
- Added `diagnostic` field to return types of `consumeReviewerArtifacts` and `consumeImplementerArtifacts` — captures which artifact is missing/malformed
- Added `dispatchArtifactFailure()` function: reads persisted retry count from `ReviewState.metadata`, increments, persists, and returns `relaunch` or `strand` decision
- Artifact retry keys: `reviewerArtifactRetryCount`, `implementerArtifactRetryCount` (independent of timeout retry counters)
- Stranded state recorded with `reviewerArtifactStrandedAt`/`implementerArtifactStrandedAt` and strand reason

**`src/adapters/review/review-loop.ts`:**
- Reviewer artifact failure (`!reviewerArtifacts.ok`): calls dispatcher, strands → `escalateToHumanReview('REVIEWER_ARTIFACT_RETRY_EXHAUSTED')`, relaunch → sets `POLL_TIMEOUT` for existing recovery loop
- Implementer artifact failure (`!implementerArtifacts.ok`): calls dispatcher, strands → returns with stranded state, relaunch → launches implementer with artifact recovery prompt and re-consumes artifacts
- Implementer timeout retry loop: artifact failures inside retry also dispatched (was `exit(1)`)

**`src/adapters/review/review-state.ts`:**
- `advanceRound()` now resets artifact retry metadata keys alongside timeout retry counters

### Reviewer Routing

| Artifact | Failure | Action |
|---|---|---|
| `review-findings.md` | Missing/malformed | Diagnostic: "missing findings" → relaunch reviewer |
| `review-outcome.md` | Missing/malformed | Diagnostic: "missing outcome" → relaunch reviewer |
| `review-verdict.txt` | Missing/malformed | Diagnostic: "missing verdict" → relaunch reviewer |
| Any | Persist failure | Diagnostic: "persist failed (findings/outcome)" → relaunch reviewer |
| Any | Provider post failure | Diagnostic: "comment/review post failed" → relaunch reviewer |

### Implementer Routing

| Artifact | Failure | Action |
|---|---|---|
| `round-resolution.md` | Missing/malformed | Diagnostic: "missing round-resolution" → relaunch implementer |
| `review-disposition.txt` | Missing/malformed | Diagnostic: "missing disposition" → relaunch implementer |
| Any | Persist failure | Diagnostic: "persist failed (round-summary/disposition)" → relaunch implementer |
| Any | Provider post failure | Diagnostic: "resolution/disposition post failed" → relaunch implementer |

### Retry Bounds

- Default: 2 retries per role per round (aligned with existing timeout retry bounds)
- Counters persisted in `ReviewState.metadata` (independent of `reviewerRetryCount`/`implementerRetryCount`)
- Reset on `advanceRound()` — each round starts fresh
- Exhaustion records stranded state with timestamp and reason; human intervention required

### ADR 0048 Preservation

- `dispatchArtifactFailure()` does not call `classifyError()` — artifact failures are inherently `MissingArtifacts` → `AutoSendBack` per ADR 0048
- Infrastructure failures (Forgejo, auth, network) are handled upstream by `classifyError()` in `handleGateFailureAutoBounce()` — those remain `HumanOnly`
- Task-state violations remain `HumanOnly` via the existing classifier

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reviewer artifacts route to reviewer relaunch | `dispatchArtifactFailure('reviewer', ...)` in `src/adapters/review/review-loop.ts` ~1380; `escalateToHumanReview('REVIEWER_ARTIFACT_RETRY_EXHAUSTED')` on strand | PASS |
| Implementer artifacts route to implementer relaunch | `dispatchArtifactFailure('implementer', ...)` in `src/adapters/review/review-loop.ts` ~1650; implementer relaunch with recovery prompt on relaunch action | PASS |
| Per-role persisted retry counters | `reviewerArtifactRetryCount` / `implementerArtifactRetryCount` in `ReviewState.metadata`; read/write in `dispatchArtifactFailure()` (`src/adapters/review/review-artifacts.ts` ~681) | PASS |
| Retry exhaustion strands with actionable state | `strand` action sets `reviewerArtifactStrandedAt`/`implementerArtifactStrandReason` in metadata; human intervention required | PASS |
| HumanOnly classifications preserved | `classifyError()` in `src/adapters/cli/commands/repair-handoff.ts` handles gate/infra failures; artifact dispatcher uses separate metadata keys — no overlap | PASS |
| Diagnostic captured for each failure | `diagnostic` field added to `consumeReviewerArtifacts` and `consumeImplementerArtifacts` return types; populated at each failure point | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` — ESLint, tsc, test-hygiene all PASS | PASS |

## Next Action

CP-3: Add focused mocked regression tests covering absent and malformed artifacts for every scoped category, independent persisted retry counts, retry exhaustion to stranded state, and HumanOnly failure categories.

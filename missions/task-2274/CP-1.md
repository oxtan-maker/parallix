# CP-1: Artifact Consumer Inventory and ADR 0048 Integration Analysis

## Summary

 inventoried all review-loop artifact consumers, mapped producing roles, and documented existing ADR 0048 classifier and persisted review state consumption patterns. Identified the gap: implementer artifact failures (`consumeImplementerArtifacts` returning `ok: false`) cause immediate `exit(1)` with no recovery, while reviewer artifact failures enter a bounded retry loop. Neither path uses the ADR 0048 `classifyError()` dispatcher for artifact-specific failures.

## Artifact-to-Producing-Role Inventory

| Artifact | Producing Role | Consumer Function | Source File | Current Failure Behavior |
|---|---|---|---|---|
| `review-findings.md` | reviewer | `consumeReviewerArtifacts` | `src/adapters/review/review-artifacts.ts` | Sets `POLL_TIMEOUT`, enters retry loop (max 2) |
| `review-outcome.md` | reviewer | `consumeReviewerArtifacts` | `src/adapters/review/review-artifacts.ts` | Sets `POLL_TIMEOUT`, enters retry loop (max 2) |
| `review-verdict.txt` | reviewer | `consumeReviewerArtifacts` | `src/adapters/review/review-artifacts.ts` | Sets `POLL_TIMEOUT`, enters retry loop (max 2) |
| `round-resolution.md` | implementer | `consumeImplementerArtifacts` | `src/adapters/review/review-artifacts.ts` | `exit(1); return;` — no recovery |
| `review-disposition.txt` | implementer | `consumeImplementerArtifacts` | `src/adapters/review/review-artifacts.ts` | `exit(1); return;` — no recovery |
| Implementation code/checkpoint | implementer | Gate checks (pre-review) | `src/adapters/review/review-loop.ts` | `handleGateFailureAutoBounce` — uses ADR 0048 classifier |
| PR-disposition | implementer | `pollForDisposition` / provider | `src/adapters/review/review-loop.ts` | Timeout retry loop (max 2) |

## ADR 0048 Classifier Consumption

- **Location**: `src/adapters/cli/commands/repair-handoff.ts`
- **API**: `classifyError(errorMsg)` returns `{ failureClass, dispatchAction, reason? }`
- **8 Failure Classes**: `UnverifiableClaims`, `MalformedGates`, `MissingArtifacts`, `IncompleteEvidence`, `GitBlockers`, `GateFailure`, `InfraBlocker`, `StateMachineViolation`
- **3 Dispatch Actions**: `AutoRepair`, `AutoSendBack`, `HumanOnly`
- **Current consumers**: `handleGateFailureAutoBounce()` in `review-loop.ts` (line ~262) and `repairHandoff()` in `repair-handoff.ts`
- **Gap**: Artifact-specific failures (missing/malformed `review-findings.md`, etc.) are NOT classified through `classifyError()`. They are detected by `consumeReviewerArtifacts` / `consumeImplementerArtifacts` returning `ok: false`, but the error message is not routed through the dispatch table.

## Persisted Review State

- **Location**: `src/adapters/review/review-state.ts`
- **Class**: `ReviewState` with fields `reviewerRetryCount`, `implementerRetryCount`, `metadata`
- **Persistence**: `persistReviewStateOrThrow()` writes to SQLite via `MissionStore` or JSON fallback
- **Current usage**:
  - `reviewerRetryCount`: incremented in reviewer timeout recovery loop (review-loop.ts ~1410), bound at 2
  - `implementerRetryCount`: incremented in implementer disposition timeout recovery loop (review-loop.ts ~1700), bound at 2
  - `metadata.gateFailureRetryCount`: gate failure retry (review-loop.ts ~402), bound at 2
  - `metadata.hookFailureRetryCount`: hook failure retry (review-loop.ts ~402), bound at 2
- **Gap**: No per-role retry counters for ARTIFACT failures (only for timeouts and gates). Artifact retry state not persisted independently.

## Key Findings

1. **Reviewer artifact recovery exists** but is ad-hoc: `ok: false` → `POLL_TIMEOUT` → timeout retry loop. No diagnostic captured about WHICH artifact failed.
2. **Implementer artifact recovery is missing**: `ok: false` → `exit(1)`. No relaunch, no retry, no diagnostic.
3. **ADR 0048 `MissingArtifacts` class** maps to `AutoSendBack` but is not invoked for review-loop artifact consumption — only for handoff-time checks.
4. **Per-role retry counters exist** (`reviewerRetryCount`, `implementerRetryCount`) but are used ONLY for timeout recovery, not artifact failure recovery.
5. **Stranded state pattern** exists in `handleGateFailureAutoBounce` (retry exhaustion → stranded with human intervention message). Same pattern needed for artifact recovery.

## Next Action

CP-2: Add role-owned artifact recovery dispatcher. Route `consumeReviewerArtifacts` and `consumeImplementerArtifacts` failures through new dispatcher that captures diagnostic, uses per-role persisted retry counters, and relaunches the producing role.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reviewer artifacts (findings/outcome/verdict) mapped to reviewer role | `consumeReviewerArtifacts` in `src/adapters/review/review-artifacts.ts`; consumed in `src/adapters/review/review-loop.ts` ~1366 | DONE |
| Implementer artifacts (round-resolution/disposition) mapped to implementer role | `consumeImplementerArtifacts` in `src/adapters/review/review-artifacts.ts`; consumed in `src/adapters/review/review-loop.ts` ~1660 | DONE |
| ADR 0048 classifier and dispatch table identified | `classifyError()` in `src/adapters/cli/commands/repair-handoff.ts`; 8 classes, 3 actions; `MissingArtifacts` → `AutoSendBack` | DONE |
| Persisted review state fields identified | `ReviewState.reviewerRetryCount`, `implementerRetryCount` in `src/adapters/review/review-state.ts` | DONE |
| Current failure behavior documented | Reviewer: retry loop (review-loop.ts ~1405). Implementer: `exit(1)` (review-loop.ts ~1663). Gate: `handleGateFailureAutoBounce` (review-loop.ts ~353) | DONE |

# Checkpoint 5: End-to-end verification

## Summary
All SC1-SC9 from locked MISSION.md implemented and verified. Round 3 blocker (F1) resolved: hookFailureRetryCount now persists through operator database via migration 0012, mission-store SELECT/INSERT/UPDATE, and serialization round-trip. Both call sites wire missionStore to the handler.

## Lifecycle Failure-Mode Coverage

Parallix develops itself through more than the standalone rebase and integrate commands. The relevant boundaries are now explicitly covered:

- Draft and active agents may leave changes for their safety-harness commits; those commit failures remain visible to the invoking stage and do not falsely advance a task.
- Handoff runs the declared mission gates before a review PR exists. A failed declared gate captures stdout/stderr, relaunches the implementer, and retries handoff up to two times; only a persistent failure prevents reviewer launch.
- Before every reviewer round, startReviewLoop() runs rebaseBeforeReviewRound() and then runPreReviewGate(). A hook failure in the pre-review safety commit is classified, persisted as hookFailureRetryCount, and rebounced to the implementer before any reviewer launch. A hook failure emitted by the per-round verification command follows the same hook-specific rebounce path.
- The nested px rebase --push path covers initial replay and all git rebase --continue retries. The landed squash commit in px integrate uses the same bounded retry budget.

Each rebounce stops the current reviewer attempt before a reviewer cycle is consumed. The implementer receives the exact hook output and retry number; restarting the loop re-runs the pre-review rebase and verification gate. After two persisted hook retries, the mission strands with the hook diagnostic rather than looping indefinitely.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: `rebase.ts` classifies hook failures, returns `hookFailure: true` | `src/adapters/cli/commands/rebase.ts:21` (`classifyHookFailure`), `:372` (auto-bounce wired) | PASS |
| SC2: `integrate.ts` classifies squash commit hook failures | `src/adapters/cli/commands/integrate.ts:32` (`classifyHookFailure`), `:1132` (auto-bounce wired) | PASS |
| SC3: Hook failure in rebase triggers auto-bounce with fix prompt | `src/adapters/cli/commands/rebase.ts:58` (`handleHookFailureAutoBounce`), `:372-392` (initial rebase), `:527-556` (--continue path) | PASS |
| SC4: Hook failure in integrate triggers auto-bounce with fix prompt | `src/adapters/cli/commands/integrate.ts:57` (`handleHookFailureAutoBounce`), `:1132-1155` (wired with retry) | PASS |
| SC5: Retry after implementer fix | `src/adapters/cli/commands/rebase.ts:380` (`git rebase --continue`), `src/adapters/cli/commands/integrate.ts:1131` (`git add -A` before retry commit) | PASS |
| SC6: `hookFailureRetryCount` in metadata, strand after 2 retries | `src/domain/review.ts:277` (domain field), `src/adapters/review/review-state-mapping.ts:33-35` (metadataFromReview), `:172-174` (applyReviewStateToReview), `:605-609` (recordHookFailureRetry), SQLite migration 0012 + mission-store SELECT/INSERT/UPDATE + serialization round-trip | PASS |
| SC7: `classifyHookFailure` exported from `rebase.ts` | `src/adapters/cli/commands/rebase.ts:21` | PASS |
| SC8: `classifyHookFailure` exported from `integrate.ts` | `src/adapters/cli/commands/integrate.ts:32` | PASS |
| SC9: Unit tests cover detection, bounce, retry, strand, non-hook | `test/task-2340-hook-rebounce.test.ts` — 34 tests, 8 suites | PASS |
| `rebase.ts` (review) propagates hook failure | `src/adapters/review/rebase.ts:25` (`HOOK_FAILURE_RE`), `:197` (returned in result) | PASS |
| Verification gate passes | `./scripts/verify-local.sh all` — 1855 tests, 0 failures | PASS |
| F1: hookFailureRetryCount round-trip via SQLite | `src/adapters/sqlite/migrations/0012-review-hook-retries.sql`, `src/adapters/sqlite/mission-store.ts:158,478-493`, `src/adapters/sqlite/mission-serialization.ts:74,459` | PASS |
| F1: missionStore wired from call sites | `src/adapters/cli/commands/rebase.ts:375-376` (missionServicesFn), `src/adapters/cli/commands/integrate.ts:1172` (missionServices.store) | PASS |
| F1: production rebase composed with mission factories | `src/composition/create-cli.ts:134` (withMissionFactories wrapper) | PASS |
| Pre-review safety-commit hook rebounces before reviewer launch | `src/adapters/review/rebase.ts:106-113`, `src/adapters/review/review-loop.ts:1185-1220`, test name "uses the hook retry budget and hook-specific prompt for a gate-stage hook failure" | PASS |
| Per-round verification hook uses hook retry metadata, not gate retry metadata | `src/adapters/review/review-loop.ts:382-390`, test name "uses the hook retry budget and hook-specific prompt for a gate-stage hook failure" | PASS |
| Reviewer gate is executed before every round | `src/adapters/review/review-loop.ts:1237-1272`, `test/task-1268-pre-review-gate-per-round.test.ts` | PASS |
| Declared handoff gate captures output, relaunches, and retries | `src/adapters/cli/commands/handoff.ts:687-698`, `src/adapters/cli/commands/active.ts:450-492`, test name "runHandoffAndReview relaunches on declared gate failure with captured output (SC3)" | PASS |

Next action: Submit for review (round 4).

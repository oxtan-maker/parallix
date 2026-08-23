# CP-4: Goal Check — all acceptance criteria #1–#6

## Summary of work done
Applied both halves of the fix and verified every acceptance criterion against
durable evidence. Branch A of `recoverMissionForIntegration`
(`src/adapters/cli/commands/integrate.ts`) skips the `submitForReviewFn` handoff
replay for an already-approved `active` round and drives the `active → review`
move via a direct transition; the `submit-for-review` guard
(`src/domain/mission-workflow.ts`) recognises the decided round and advances the
lane to `review` without rewriting it, so the downstream `approve` runs at the
stored `decidedAt`. The reproduction test `test/task-2397-integrate-active-approved-recovery.test.ts`
is red before the fix (real `A submitted review must be awaiting a reviewer
decision` abort at `integrate.ts:1081`) and green after.

Review round 1 tightened the recovery boundary: a stored approved decision only
enters this path when the current provider read also reports the required
default-user approval. It also added a distinct fresh `awaiting-review`
regression so AC #3 no longer cites the already-approved R4 scenario.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| #1 active + approved → `integration`, no `IntegrationAbort` | `test/task-2397-integrate-active-approved-recovery.test.ts`, `task-2397: active + approved review recovers to integration without resubmitting`; `test/integrate.test.ts`, `R4b: stale active approved recovery requires the provider approval`; `` `node --import tsx --experimental-test-module-mocks --test test/integrate.test.ts test/task-2397-integrate-active-approved-recovery.test.ts` `` | PASS |
| #2 no `submitForReview` replay, round/`decidedAt`/change preserved | `test/integrate.test.ts`, `R4: stale active approved recovery skips submit-for-review replay, then approves at original decidedAt` (line 1629) asserts `submitForReviewCalled === false`; `` `node --import tsx --experimental-test-module-mocks --test test/integrate.test.ts` `` (77 pass); `src/adapters/cli/commands/integrate.ts` Branch A skips the replay | PASS |
| #3 fresh `awaiting-review` round still `active → review` via handoff | `test/integrate.test.ts`, `R4c: fresh awaiting-review recovery still uses the handoff operation`; `` `node --import tsx --experimental-test-module-mocks --test test/integrate.test.ts` `` | PASS |
| #4 Branch B (`review`) externally-approved recovery intact | `test/integrate.test.ts`, `R5: stale active recovery with human override persists a real ReviewerDecision, then chains existing operations` asserts `approveEvents[0].occurred_at == decidedAt` (line 1731); `test/task-2378-authoritative-stats.test.ts`, `occurredAt equals ReviewerDecision.decidedAt` | PASS |
| #5 focused reproduction test exists and locks bug | `test/task-2397-integrate-active-approved-recovery.test.ts` (2 tests); verified red→green by stashing the source fix | PASS |
| #6 `./scripts/verify-local.sh static-analysis` passes | gate report: ESLint clean, `npm run typecheck` clean, test-hygiene clean, test typecheck clean; `` `./scripts/verify-local.sh static-analysis` `` | PASS |

## Next action:
All checkpoints committed and the single mission gate (`static-analysis`) plus
the `docs` gate pass. No uncommitted mission or checkpoint documents remain.
Mission is ready for Parallix lifecycle handoff (not performed by this agent).

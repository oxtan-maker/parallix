# CP-3 — Move normal approval to authoritative boundary

## Summary

Wired `ReviewerDecision.decidedAt` into `review → integration` at the approval
boundary. Two changes:

### 1. `ReviewState.save()` fires lifecycle transition on approval

`ReviewState.save()` is the single shared chokepoint all approval paths route
through (`submitReviewRound`, `consumeArtifacts`, `review-agent-fallback`,
`rebase-workflow-adapter`). After persisting the Review aggregate, if the
review phase is `approved`, the method triggers the `MissionLifecycleService`
`approve` transition with `occurredAt = ReviewerDecision.decidedAt`.

The `lifecycleService` is injected via an optional 6th parameter to
`persistReviewStateOrThrow()` and optional 4th parameter to `writeReviewState()`.
Both signatures remain backward-compatible with existing callers that pass
`MissionStore` positionally.

When the lifecycle transition fails (e.g. version conflict), the review
persistence succeeds and `px integrate` recovery repairs the stale review state.

### 2. `integrate.ts` recovery uses `decidedAt` instead of `new Date()`

`promoteTaskForIntegrationIfNeeded()` reads `ReviewerDecision.decidedAt` from
the Mission's Review aggregate and uses it as `occurredAt` for the `approve`
transition. Previously used `new Date().toISOString()` — the exact defect
behind R2/R3.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `ReviewState.save()` triggers `approve` transition when review is approved | `src/adapters/review/review-state.ts` `save()` method — `if (lifecycleService && this.phase === 'approved')` block | PASS |
| Transition uses `ReviewerDecision.decidedAt` as `occurredAt` | `src/adapters/review/review-state.ts` — `occurredAt: decidedAt` from `currentRound.decision.decidedAt` | PASS |
| All approval paths route through `ReviewState.save()` | `submitReviewRound`, `consumeArtifacts`, `review-agent-fallback`, `rebase-workflow-adapter` all call `persistReviewStateOrThrow` → `writeReviewState` → `ReviewState.save()` | PASS |
| `integrate.ts` recovery uses `decidedAt` not `new Date()` | `src/adapters/cli/commands/integrate.ts` — reads `reviewRound.decision.decidedAt` for `occurredAt` | PASS |
| Backward-compatible signatures (existing callers unchanged) | `writeReviewState(slug, state, worktree, missionStore)` still works via `'save' in options` detection | PASS |
| Domain tests pass | `npx tsx --test test/domain-mission.test.ts` — 17 pass, 0 fail | PASS |
| Review state tests pass | `npx tsx --test test/review-state.test.ts` — 10 pass, 0 fail | PASS |
| No new type errors | `npx tsc --project tsconfig.test.json --noEmit` — no errors in changed files | PASS |

Next action: CP-4 — implement recovery orchestration for stale `active`/`review`/`integration` states in `px integrate`.

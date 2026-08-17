# CP-5 — R5 human-override regression

## Summary

Added the R5 human-override regression through the existing `px review` decision path
(SC07). No new CLI flag on `px integrate` (carried scope decision from task-2376) and no new
domain types — the test consumes the existing `decidedAt` only.

**Test** — `test/task-2378-authoritative-stats.test.ts`,
`"R5: human px review approval persists ReviewerDecision and lands integration at decidedAt
without a second approval"`:

1. Seeds a live Mission (status `review`, not closed) whose Review is awaiting a decision
   (round 1 via `startReview`, `decision: null`, `startedAt = decidedAt`). The seed sits in the
   `review` lane because the domain's `approve` rule requires it (`decideMission`: "Cannot
   approve while … is active") — an awaiting Review on a live mission is the state a human
   override applies to.
2. Applies a human approval through the existing decision path:
   `submitReviewRound(slug, 'approve', …)` with `provider=none` and persistence bound to the
   real store + real `MissionLifecycleService` (exactly the production wiring via
   `bindReviewPersistence`).
3. Asserts: no operator-visible failure and no non-zero exit; a persisted
   `ReviewerDecision(kind=approved)` with `decidedAt` intact; the Mission reached
   `integration`; the `review → integration` lane event carries `trigger: 'approve'` and
   `occurred_at` **exactly equal** to `decidedAt`; and the Backlog task was promoted only
   because the boundary succeeded.
4. Runs the `px integrate` recovery authority (`recoverMissionForIntegration`, the same function
   the `px integrate` command uses) against the now-`integration` Mission and asserts it
   proceeds as a no-op (`{ recovered: false, status: 'integration' }`) creating **no second
   approval event** (exactly one `approve` lane event remains).

The test runs in the integration layer (it seeds a real migrated operator database and a real
git worktree, like the task-2376 repro) and was declared in
`test/default-test-suite.test.ts` in CP-4.

**Verification**

- `test/task-2378-authoritative-stats.test.ts` → 3/3 green (both CP-1 cases + R5).
- `./scripts/verify-local.sh static-analysis` — all stages clean (ESLint, `tsc --noEmit`,
  test-hygiene, test typecheck).
- `./scripts/verify-local.sh all` — exit 0, 0 failures.
- SC11: no new domain types, no second Review/lifecycle subsystem, no new dependency; R5 routes
  through the existing `submitReviewRound` decision path and the existing
  `recoverMissionForIntegration` operations.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| R5 regression exists via the existing `px review` decision path (SC07) | `"R5: human px review approval persists ReviewerDecision and lands integration at decidedAt without a second approval"` in `test/task-2378-authoritative-stats.test.ts` | PASS |
| Persisted `ReviewerDecision(kind=approved)` asserted | Same test (round decision `kind === 'approved'`, `decidedAt` intact) | PASS |
| `review → integration` with `occurredAt` exactly equal to `decidedAt` | Same test (`board_lane_events` `occurred_at === decidedAt`) | PASS |
| `px integrate` proceeds without re-running approval | Same test (`recoverMissionForIntegration` no-op; exactly one `approve` lane event) | PASS |
| No new CLI flag on `px integrate`; no new domain types (SC11) | Test consumes existing `submitReviewRound` + `recoverMissionForIntegration`; `src/domain/review.ts` unchanged | PASS |
| Verification gates green | `./scripts/verify-local.sh all` (exit 0, 0 failures), `./scripts/verify-local.sh static-analysis` (all stages clean) | PASS |

Next action: CP-6 — contradiction/dead-code sweep: search and classify the backlog pattern list
(`requireStatus(mission, ['review'`, `command: { type: 'approve' | 'integrate' |
'submit-for-review' }`, `decidedAt`, `new Date().toISOString()`, the four deleted helper names,
`MissionStore?`), delete anything left over from this mission's changes, and re-run the full
R1–R13 regression set.

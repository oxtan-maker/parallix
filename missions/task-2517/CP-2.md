# CP-2 — Pre-landing guard: prove the integration decision before any remote effect

The landing path no longer performs an irreversible remote effect before it has proven that the Mission can accept the `integrate` decision.

Three changes:

1. `src/application/integrate-workflow.ts` — after the integration gates return (including the TASK-2492 rebound route that re-ran them green), the run restores the lane through `recoverMissionForIntegration`, which owns the authoritative timestamps (review round `startedAt`, approval `decidedAt`) rather than the wall clock, and aborts before landing when the lane is still not `integration`. The lane events reuse their stable idempotency keys, so a restore after a rebound replays the already-recorded transition instead of double-emitting it.
2. `src/application/integrate/squash.ts` — `finishLanding` now calls `persistLandedIntegrationOrAbort` (whose `decideIntegration` is the eligibility question) *before* the Forgejo sync-merge. A rejection aborts with `IntegrationAbort` while the review PR is still open and the remote branch still exists.
3. `src/application/integrate/github-pr.ts` — the `github-pr` landing loads the Mission and rejects a non-`integration` lane before `submitOrObserveGithubPr` submits or merges the PR.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 lane is restored to `integration` at an authoritative timestamp before any landing effect runs | `src/application/integrate-workflow.ts` restore + abort after `runRequiredLocalGates`, reusing `recoverMissionForIntegration` (`test/task-2397-integrate-active-approved-recovery.test.ts` still green: `task-2397: active + approved review recovers to integration without resubmitting`) | Complete |
| SC2 landing aborts with zero remote side effects when the Mission cannot accept the integration decision (local mode) | `TASK-2517: rebounded landing aborts before Forgejo sync when integration is ineligible` in `test/task-2517-integrate-rebound-landing-guard.test.ts` | Complete |
| SC2 same guard for the `github-pr` landing (no PR submit/merge/branch delete) | `TASK-2517: github-pr landing aborts before the PR is observed or merged when the lane is active` in `test/task-2517-integrate-rebound-landing-guard.test.ts` | Complete |
| Gate-rebound behavior is unchanged | `npm test -- test/task-2492-integrate-gate-bounce.test.ts test/task-2517-integrate-rebound-landing-guard.test.ts test/task-2397-integrate-active-approved-recovery.test.ts` — 7 passed, 0 failed | Complete |
| SC6 the declared reproduction is red at the parent commit and green now | `test/task-2517-integrate-rebound-landing-guard.test.ts` (red at `d721b5a35`: sync ran before the decision) | Complete |

Next action: CP-3 — add the stranded-mission closeout command that closes an already-landed mission stuck in `active`/`review` to `done` with a non-null `closedAt` and removes its worktree and local branch.

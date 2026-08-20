# CP 3 — Boundary convergence (Parts A/B/E)

## Summary

Converged the one remaining approval producer — the `defaultUserApproved`
human override — onto the authoritative Review domain, so every genuine
approval now persists `review → integration` at the `decidedAt` boundary.

Changes:

- `src/adapters/forgejo/forgejo-pr.ts` — `getLatestReviewDecision` now returns
  `defaultUserApprovedAt`: the `submitted_at` of the latest non-dismissed
  default-user `APPROVED` review. The override keeps its own authoritative
  timestamp (Part F); it is no longer a boolean without a time.
- `src/adapters/cli/commands/integrate.ts`:
  - new `recordHumanOverrideDecision`: persists the override as a real
    `ReviewerDecision(kind=approved, decidedAt=T)` through the existing Review
    domain (`applyReviewerCommand`) + the sanctioned `store.save` aggregate
    write, then re-loads. It refuses to rewrite a non-`awaiting-review`
    round (the domain rules stay in the domain) — recovery then stops with an
    actionable error.
  - `recoverMissionForIntegration` — an explicit override (`approval.ok &&
    defaultUserApproved === true && defaultUserApprovedAt`) on a
    review-without-decision Mission persists the decision and then runs the
    existing `approve` transition with `occurredAt = decidedAt`. A stale
    `active` Mission without Review facts plus an override first invokes the
    existing handoff operation (`submit-for-review`) and then the same
    override + approve chain. `defaultUserApproved` is no longer read anywhere
    as lifecycle authority.
  - `evaluateTaskStatusForIntegration` — the `defaultUserOverride` acceptance
    branch is deleted; the check now accepts the authoritative
    `context.missionStatus` (`integration`/`done`) or the existing
    approved/`APPROVED`/local-review-state facts. Backlog promotion follows
    the durable transition (still strictly after it, via
    `promoteTaskForIntegrationIfNeeded` → recovery → promotion).
  - `printIntegrationPreflight` — when the Mission lifecycle is already
    `integration`/`done`, the provider state read at context-build time is
    reported informational (PASS); the `defaultUserApproved` FAIL-suppression
    and WARN branches are deleted.
- `src/composition/create-cli.ts` — the `review-event` site now calls
  `bindReviewPersistence(services.mission.store, services.mission.lifecycle)`.
  No unbound production review-persistence call site remains.

Tests:

- `test/task-2379-approval-boundary-repro.test.ts` went RED→GREEN:
  `"delayed integration: review dwell is 30m and integration dwell is 225m (R2)"`
  now passes (override persisted at 10:30, transition `occurredAt = 10:30`,
  one `integration → done @ 14:15`, dwell 30m/225m through
  `medianCycleTimeByStateSeries`).
- `test/integrate.test.ts` — the two old-semantics tests
  ("evaluateTaskStatusForIntegration accepts review when default user approved
  but latest is REQUEST_CHANGES" and the task-1219 fallback twin) are rewritten
  to the new semantics: the raw boolean is rejected without the lifecycle;
  `missionStatus: 'integration'` is accepted. New regression tests R5 (stale
  `active` + override → real `ReviewerDecision` + existing-operation chain) and
  R6 (stale `active` without facts and without override → abort, not done)
  added; R4/R7/R9/recovery tests unchanged and green.
- `test/forgejo.test.ts` — `getLatestReviewDecision` expectations extended with
  the exact `defaultUserApprovedAt` timestamps.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every approval producer converges on the `decidedAt` boundary (SC1/SC4) | `test/task-2379-approval-boundary-repro.test.ts` ("delayed integration: review dwell is 30m and integration dwell is 225m (R2)"); `test/task-2378-authoritative-stats.test.ts` ("R5: human px review approval persists ReviewerDecision and lands integration at decidedAt without a second approval"); `test/task-2376-lifecycle-timing.test.ts` ("R1 production: local approval path transitions Mission to integration before px integrate") | PASS |
| Human override persists a real `ReviewerDecision`, not a boolean (SC5/SC17) | `test/integrate.test.ts` ("R5: stale active recovery with human override persists a real ReviewerDecision, then chains existing operations"); `recordHumanOverrideDecision` in `src/adapters/cli/commands/integrate.ts` uses `applyReviewerCommand` from `src/domain/review.ts` | PASS |
| Override carries its own timestamp (Part F) | `test/forgejo.test.ts` ("getLatestReviewDecision detects defaultUserApproved when default user approved but latest review is REQUEST_CHANGES" — asserts `defaultUserApprovedAt: '2026-04-12T10:00:00Z'`); `getLatestReviewDecision` in `src/adapters/forgejo/forgejo-pr.ts` | PASS |
| `defaultUserApproved` removed as preflight/lifecycle authority | `test/integrate.test.ts` ("evaluateTaskStatusForIntegration rejects a raw defaultUserApproved boolean without the Mission lifecycle", "evaluateTaskStatusForIntegration accepts review once the Mission lifecycle left it"); `test/task-1219-fallback.test.ts` ("evaluateTaskStatusForIntegration: defaultUserApproved boolean is not an approval authority without the lifecycle") | PASS |
| No unbound production review-persistence site remains | `src/composition/create-cli.ts` (both sites now bind store + lifecycle); `bindReviewPersistence` in `src/composition/review-persistence.ts`; `test/task-2339-review-store-bindings.test.ts` | PASS |
| Backlog promotion stays after the durable transition | `test/integrate.test.ts` ("promoteTaskForIntegrationIfNeeded updates the task file on a real integration run"); `promoteTaskForIntegrationIfNeeded` in `src/adapters/cli/commands/integrate.ts` | PASS |
| No new recovery state machine / second subsystem (SC17) | recovery still routes through `submitForReviewFn` + `lifecycle.transition` in `src/adapters/cli/commands/integrate.ts`; domain rules unchanged in `src/domain/mission-workflow.ts` | PASS |
| Affected suites green | `node --experimental-test-module-mocks --import tsx --test test/integrate.test.ts` → 75/75; review+stats suites (10 files) → 183/183 | PASS |

Next action: CP 4 — recovery orchestration (Parts C/D/F): verify the full matrix (stale `active`/`review`/`integration`/`done`-resume) by re-running R3–R9 plus the `persistLandedIntegrationOrAbort` closeout regressions, and document the stop-when-facts-missing semantics.

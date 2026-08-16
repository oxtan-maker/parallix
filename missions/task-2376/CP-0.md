# CP-0 — Baseline and path inventory

## Summary

Recorded the baseline commit and working-tree state, then traced every production path this
mission must change: review approval producers, the human-override branch in `px integrate`,
the `submit-for-review` / `approve` / `integrate` domain commands, `MissionIntegrationService`,
the `reviewFixRounds` and implementer derivations, and the four external inference helpers.

### Baseline

- `BASELINE_SHA` = `efd8cc38655bcd01f6beff0abaca2c0e6ec6688d` (branch `mission/task-2376`)
- `git status --porcelain` = empty (clean worktree)
- `node_modules` present in this worktree (see `mission-worktree-needs-npm-install` hazard — not hit here)

### Path inventory

**Domain state machine** — `src/domain/mission-workflow.ts`
- `MissionCommand` union: `activate`, `submit-for-review`, `request-changes`, `approve`, `integrate`
- `submit-for-review` allows `['active','review']` and is **idempotent**: a mission already at
  `review` is returned untouched, so no lane event is emitted. This is the CP-0 risk the mission
  flagged — recovery from `active` must therefore check the mission's status *before* calling it,
  and must not treat "untouched" as "transitioned".
- `approve` allows `['review']`, requires `reviewStatus(review) === 'approved'`, sets `integration`.
- `integrate` currently allows `['review','integration']` → **the `review → done` shortcut to remove (Part G / SC10)**.

**Lifecycle application service** — `src/application/mission-lifecycle-service.ts`
- `MissionLifecycleService.transition()` takes `occurredAt` from the request and writes it verbatim
  onto the `LaneTransitionEvent` via `laneEvent()`. The timestamp authority is therefore entirely
  the caller's; the fix is at the call sites, not in the service.
- `triggerFromTransition('review','integration') === 'approve'` (`src/domain/board-event.ts`), so the
  approve transition is exactly the event the dwell projection reads.

**Integration application service** — `src/application/mission-integration-service.ts`
- `decideIntegration()` issues `decideMission(mission, { type: 'integrate' })` and emits
  `integration → done` at `request.occurredAt ?? new Date()`. Once the domain rule is hardened this
  service is the place a stale `review` mission will be rejected.

**Review approval producers (Part B)** — all converge on one chokepoint
- `submitReviewRound()` (`src/adapters/review/review-commands.ts`) — provider=none branch and
  provider-backed branch, plus the self-author-skip fallback
- `consumeArtifacts()` (`src/adapters/review/review-commands.ts`) — automated/artifact review
- `src/adapters/review/review-agent-fallback.ts` (3 call sites)
- `src/adapters/rebase/rebase-workflow-adapter.ts` (2 call sites)
- Every one of these persists through `persistReviewStateOrThrow` → `writeReviewState` →
  `ReviewState.save()` (`src/adapters/review/review-state.ts`), which applies
  `applyReviewStateToReview` and calls `store.save(...)` directly. `applyReviewStateToReview`
  produces `ReviewerDecision{kind:'approved', decidedAt: round.startedAt}` for `phase === 'approved'`
  (`src/adapters/review/review-state-mapping.ts`). **`ReviewState.save()` is the single shared
  orchestration point** the mission asks for — no adapter needs its own copy of the transition.
- `applyReviewerCommand` (`src/domain/review.ts`) has no production caller outside the domain and
  its tests; it is not a separate approval path.

**Human override / `px integrate` preflight & recovery** — `src/adapters/cli/commands/integrate.ts`
- `evaluateTaskStatusForIntegration()` computes `reviewCanProceed` / `defaultUserOverride` as plain
  booleans off `context.approval` — this is the `approval.ok = true` shadow authority Part E forbids.
- `promoteTaskForIntegrationIfNeeded()` performs the only lifecycle repair today: if the mission is
  `review` it issues `command: { type: 'approve' }` with **`occurredAt: new Date().toISOString()`**
  (`src/adapters/cli/commands/integrate.ts:879`) — the exact defect behind R2/R3. Any other status
  than `review`/`integration` aborts; there is no `active` recovery at all today.
- `src/adapters/cli/commands/integrate-command.ts:817` holds a second copy of the same block. Only
  `integrate.ts` is wired into production (`src/composition/create-cli.ts:26`,
  `src/adapters/rebase/rebase-workflow-adapter.ts:15`); `integrate-command.ts` is referenced only by
  tests. Consolidating the two is TASK-2372 work and stays out of scope.

**Statistics derivation** — `src/adapters/cli/commands/stats.ts`
- `deriveImplementerAndFixRounds(slug, rootDir, missionStore = null)` — `missionStore` defaults to
  `null`, and `loadMissionReview` returns `null` for a missing store, which silently drops into the
  heuristic chain. This is the SC19 / AC22 defect.
- Heuristic chain to delete: `deriveImplementerAndFixRoundsFromPrComments` (`source: 'pr-comments'`),
  `deriveFinalImplementerFromBranchHistory` (`source: 'branch-history'`, also used *inside* the
  authoritative branch as an implementer fallback), `deriveFixRoundsFromReviewStateHistory`,
  `deriveFixRoundsFromTaskText` (`source: 'backlog-fallback'`).
- Callers: `recordIntegrationStats` (passes `missionStore` through), `createStatsWorkflowAdapter`
  (**omits `missionStore` entirely** — caller bug per Part J), `stats-backfill.ts:237` via the
  injected `s.deriveImplementerAndFixRounds` seam, and the `_internals` export used by tests.

**Lane-dwell projection (CP-8 target)** — `src/application/projections/metrics.ts`
- `deriveLaneIntervals` → `medianCycleTimeByStateSeries` → `laneDwell(dwell, 'review')` /
  `laneDwell(dwell, 'integration')` inside `buildBoardMetrics`. This is the projection Board/FLOW
  consumes (`src/interfaces/tui/flow-panel.tsx`), so the R2 assertion goes through it.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Baseline SHA and clean worktree recorded | `BASELINE_SHA=efd8cc38655bcd01f6beff0abaca2c0e6ec6688d`, `git status --porcelain` empty; verified reproducible with `git log -1 --format=%H` | PASS |
| Domain command surface inventoried | `src/domain/mission-workflow.ts` `MissionCommand` union; `requireStatus(mission, ['review','integration'], command)` for `integrate` confirms the Part G shortcut exists | PASS |
| `submit-for-review` idempotency risk audited (mission CP-0 risk item) | `src/domain/mission-workflow.ts` `case 'submit-for-review'` returns the mission untouched when `mission.status === 'review'`; covered today by `test/domain-mission.test.ts` | PASS |
| All approval producers traced to one chokepoint | `src/adapters/review/review-commands.ts` (`submitReviewRound`, `consumeArtifacts`), `src/adapters/review/review-agent-fallback.ts`, `src/adapters/rebase/rebase-workflow-adapter.ts` all call `persistReviewStateOrThrow` → `ReviewState.save()` in `src/adapters/review/review-state.ts` | PASS |
| Wall-clock approval defect located | `src/adapters/cli/commands/integrate.ts:879` uses `occurredAt: new Date().toISOString()` for `command: { type: 'approve' }` | PASS |
| Human-override boolean located | `evaluateTaskStatusForIntegration` in `src/adapters/cli/commands/integrate.ts` returns `ok` from `context.approval?.ok`/`defaultUserApproved` with no `ReviewerDecision` | PASS |
| Inference helpers and their callers enumerated | `src/adapters/cli/commands/stats.ts` defines `deriveFixRoundsFromTaskText`, `deriveFixRoundsFromReviewStateHistory`, `deriveFinalImplementerFromBranchHistory`, `deriveImplementerAndFixRoundsFromPrComments`; callers `recordIntegrationStats`, `createStatsWorkflowAdapter`, `src/adapters/cli/commands/stats-backfill.ts` | PASS |
| Optional-`MissionStore` defect located | `deriveImplementerAndFixRounds(slug, rootDir, missionStore: MissionStore \| null = null)` plus `loadMissionReview` returning `null` on a missing store | PASS |
| Dwell projection identified for CP-8 | `src/application/projections/metrics.ts` `deriveLaneIntervals` / `medianCycleTimeByStateSeries` / `laneDwell`; existing coverage in `test/board-metrics.test.ts` | PASS |
| Test harness usable in this worktree | `npx tsx --test test/domain-mission.test.ts` → `pass 17`, `fail 0` | PASS |

Next action: CP-1 — prove from `decideMission` and `ReviewState.save` whether a Mission can reach `integration` without a Review aggregate, and record the answer before any inference helper is deleted.

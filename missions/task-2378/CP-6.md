# CP-6 — Contradiction / dead-code sweep

## Summary

Searched and classified the backlog pattern list, confirmed nothing left over from this
mission's changes is orphaned or contradictory, and re-ran the full R1–R13 + R5 + CP-1
regression set green. No deletions were required: every pattern hit is either a legitimate
production producer or pre-existing read-side code outside this mission's scope.

## Pattern classification

**1. `requireStatus(mission, ['review'`** — 2 hits, both in `src/domain/mission-workflow.ts`
(`request-changes` case, `approve` case). Legitimate domain rules (Restricted Area, unchanged
by this mission). Not contradictions.

**2. `command: { type: 'approve' | 'integrate' | 'submit-for-review' }` producers** — every
hit classified (all verified in CP-2):
- `src/domain/mission-workflow.ts` (type definitions) + `src/domain/review.ts`
  (`ReviewerCommand` type) — domain.
- `src/adapters/review/review-state.ts:722` — the approval boundary (TASK-2376).
- `src/adapters/cli/commands/integrate-command.ts:817` + `src/adapters/cli/commands/integrate.ts:958`
  — `px integrate` recovery (R4/R9).
- `src/application/mission-integration-service.ts:61` — `integrate` (integration → done).
- `src/application/handoff-command-use-case.ts:995` — `submit-for-review` (handoff).
All pass a `Review` aggregate where the domain requires one. No orphaned or speculative
producer.

**3. `decidedAt`** — every write-path use is the authoritative decision time:
- Approval boundary `src/adapters/review/review-state.ts:714-725` (`occurredAt` =
  `ReviewerDecision.decidedAt`, idempotency key from `decidedAt`).
- `px integrate` recovery `src/adapters/cli/commands/integrate.ts:960-968` (original
  `decidedAt`, never wall clock).
- `src/adapters/review/review-state-mapping.ts` (flat-state round `startedAt` — the
  task-2376 canonical mapping).
- Persistence/import (`src/adapters/sqlite/mission-serialization.ts` uses `requiredText` —
  throws on missing, never fabricates).
- `src/adapters/backlog/concrete-review-read-adapter.ts:230,239` — pre-existing read-side
  reconstruction for the board projection with a wall-clock fallback only for malformed
  legacy state (no `startedAt`). Not created or changed by this mission; live (used by
  `src/composition/board-projection.ts`); out of scope (no review-domain redesign).
  Classified, not deleted.

**4. `new Date().toISOString()`** — no occurrence in the stats derivation path
(`deriveImplementerAndFixRounds` / `loadMissionReview`) and none in the approval write path.
The only read-side fallback is the pre-existing `concrete-review-read-adapter.ts` case above.

**5. Four deleted inference helper names**
(`deriveImplementerAndFixRoundsFromPrComments`, `deriveFixRoundsFromReviewStateHistory`,
`deriveFinalImplementerFromBranchHistory`, `deriveFixRoundsFromTaskText`) — **0 matches** in
`src/` + `test/` (re-verified this checkpoint).

**6. `MissionStore?` / optional-store defaults** — none in the four SC02 functions
(`deriveImplementerAndFixRounds`, `loadMissionReview`, `recordIntegrationStats`,
`recordPostIntegrationStats` — all required, omission throws the invariant error). Remaining
`missionStore?` occurrences are read-side readers (`readReviewState` / `readReviewRounds` —
`null`/`[]` is the "no Review yet" semantic the loop needs) and command option bags supplied
by composition; none is a stats-derivation default, none is dead.

**Orphan check** — nothing created by this mission is orphaned: the `missing-authority`
source label is deleted with 0 consumers in `src/` (remaining `missing-authority` strings are
comments documenting the parent-commit defect and the R13 semantics change); `loadMissionReview`
is still the single Review reader for stats; the legacy `createStatsWorkflowAdapter(null)`
default is still consumed by the module default export; ESLint (static-analysis gate) reports
no unused imports or variables. No deletions performed.

## Regression re-run

- `test/task-2376-lifecycle-timing.test.ts` (11/11: R1, R1 production, R2, R2 sensitivity,
  R3, R8, R8 sensitivity, R10, R11, R12, R13 — R13 on the new SC08 semantics) +
  `test/integrate.test.ts` (72/72, including the recovery matrix: R4, R7, R9,
  "recovery promotes an approved Review with its original decidedAt before integration",
  "recovery refuses an active Mission without authoritative Review facts") +
  `test/task-2378-authoritative-stats.test.ts` (CP-1 case 1, CP-1 case 2, R5) → **86/86 green**.
- `./scripts/verify-local.sh static-analysis` — all stages clean (ESLint, `tsc --noEmit`,
  test-hygiene, test typecheck).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Backlog pattern list searched and classified | Classification table above (patterns 1–6) | PASS |
| 0 matches for the four deleted inference helpers | `grep -rn` over `src/ test/` → 0 (re-verified) | PASS |
| No wall-clock fabrication on the approval / stats write paths | `src/adapters/review/review-state.ts` (boundary uses `decidedAt`), `src/adapters/cli/commands/stats.ts` (no `new Date()` in derivation) | PASS |
| No orphaned imports / tests / helpers from this mission's changes | ESLint clean (static-analysis gate); `missing-authority` has 0 `src/` consumers | PASS |
| Full R1–R13 + R5 + CP-1 regression set green | `test/task-2376-lifecycle-timing.test.ts` + `test/integrate.test.ts` + `test/task-2378-authoritative-stats.test.ts` → 86/86 | PASS |

Next action: CP-7 — full verification: `git diff --check` + `./scripts/verify-local.sh all`;
answer the Definition of DoD questions with evidence; close the mission.

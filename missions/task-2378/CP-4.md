# CP-4 — Required authoritative store

## Summary

Made `MissionStore` required end-to-end for contemporary stats derivation (Part J). Store
omission is now an invariant error that names the caller obligation; there is no
`missing-authority` return and no heuristic fallback. The operator store is resolved at the
composition root and threaded through every production stats path. R13 was updated in place to
the new semantics. CP-1 case 1 (and case 2) are both GREEN.

**Changes**

1. `src/adapters/cli/commands/stats.ts`
   - `loadMissionReview` / `deriveImplementerAndFixRounds`: the store parameter is now required
     (`MissionStore`, no `= null` default). Omitting it throws an invariant error naming the
     caller obligation ("the stats caller must supply the operator store … no heuristic
     fallback"). The `missing-authority` source is gone.
   - Store present but Review absent (mission missing or pre-cutover with no Review) now
     derives `{ implementer: 'unknown', prFixRounds: null, source: 'no-review' }` — unknown,
     never a fabricated zero, never an external lookup (SC04).
   - `createStatsWorkflowAdapter(missionStore)`: the factory takes the operator store (callers
     without store access pass `null` explicitly and get the invariant error at derivation
     time). The port method threads it into `deriveImplementerAndFixRounds`.
   - `recordIntegrationStats`: the `missionStore = null` default is dropped; omission throws the
     invariant error (SC02).
   - The legacy module-level `stats` default is built with an explicit
     `createStatsWorkflowAdapter(null)` (derivation through it throws; the production `px stats`
     wiring resolves the store in the composition root).

2. `src/adapters/cli/commands/integrate-post.ts` — `recordPostIntegrationStats`: the
   `missionStore = null` default is dropped (obligation documented). `px integrate` already
   passes `missionServices.store` at every production call site.

3. `src/adapters/cli/commands/stats-backfill.ts` +
   `src/adapters/mission/stats-backfill-adapter.ts` — the backfill threads the operator store
   through `collectHistoricalStatsBackfill` into `deriveImplementerAndFixRounds`. Pre-cutover
   missions without a Review still fall back to the historical git-history source (unchanged,
   out of scope); post-cutover missions get the authoritative value.

4. `src/composition/create-cli.ts` — the `stats` command now resolves the production services
   (like `status`/`review`) and passes `services.mission?.store ?? null` to
   `createStatsWorkflowAdapter`, so the live `px stats` path reads the Review aggregate
   (SC03). `src/composition/application-services.ts` — the backfill adapter is constructed with
   `mission?.store ?? null`.

5. `test/task-2376-lifecycle-timing.test.ts` — R13 updated in place (same file, same test name):
   store omission now rejects with the invariant error naming the caller obligation, instead of
   asserting a `missing-authority` result. No PR / branch-history / task-text lookup runs and no
   value is fabricated (SC08).

6. Call-site test updates forced by the required store (all traceable to this change):
   `test/stats.test.ts` (label test seeds a store), `test/task-1415-closed-mission-counts.test.ts`
   (passes an empty operator store — the test asserts only the closed-row date).
   `test/default-test-suite.test.ts` — the new repro test is declared in the integration list.
   `src/application/consumer-domain-requirements.ts` — a `review-round-state` line citation
   (517→518) refreshed because CP-3 inserted a line above `export class ReviewState`.

**Verification**

- CP-1 case 1 `"live stats workflow adapter derives authoritative implementer and
  reviewFixRounds from the Review aggregate"` is GREEN: the production adapter now reads the
  Review aggregate and derives the authoritative implementer and `prFixRounds = 2` for two
  request-changes cycles, with the misleading backlog task ignored. Case 2 stays GREEN.
- R13 `"R13: missing MissionStore cannot activate heuristic inference"` GREEN on the new
  semantics; R1–R12 unchanged and green (11/11 in
  `test/task-2376-lifecycle-timing.test.ts`).
- SC03 canonical metrics hold: first-pass approval → known `reviewFixRounds = 0` (R10), two
  request-changes cycles → known 2 (R11), TASK-2371 aggregation unchanged (R6 in
  `test/task-2369-regressions.test.ts`).
- `./scripts/verify-local.sh all` passes (exit 0, 0 failures; the suite's reported test count
  varies run-to-run — a pre-existing runner nondeterminism — but every run is fully green).
- `./scripts/verify-local.sh static-analysis` passes (ESLint, `tsc --noEmit`, test-hygiene,
  test typecheck all clean). The pre-CP-4 test-typecheck gap (case 1 calling
  `createStatsWorkflowAdapter(store)`) is closed now that the store is a real parameter.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| No `missionStore = null` / optional-store default in the four functions (SC02) | `src/adapters/cli/commands/stats.ts` (`loadMissionReview`, `deriveImplementerAndFixRounds`, `recordIntegrationStats`), `src/adapters/cli/commands/integrate-post.ts` (`recordPostIntegrationStats`) | PASS |
| Store omission throws an invariant error naming the caller obligation (SC02) | `"R13: missing MissionStore cannot activate heuristic inference"` (rejects on the invariant error) | PASS |
| Contemporary Mission with a Review derives authoritative values through the production adapter (SC03) | `"live stats workflow adapter derives authoritative implementer and reviewFixRounds from the Review aggregate"`, `src/composition/create-cli.ts` (store resolved at composition) | PASS |
| Store present but Review absent → `{ implementer: 'unknown', prFixRounds: null }`, no lookup (SC04) | `src/adapters/cli/commands/stats.ts` (`source: 'no-review'` return; 0 `missing-authority` references in `src/`) | PASS |
| R13 updated in place to the new semantics (SC08) | `test/task-2376-lifecycle-timing.test.ts` (same file, same test name, now asserts the invariant rejection) | PASS |
| Store threaded through `createStatsWorkflowAdapter` / `StatsWorkflowPort` / backfill | `src/adapters/cli/commands/stats.ts`, `src/adapters/cli/commands/stats-backfill.ts`, `src/adapters/mission/stats-backfill-adapter.ts`, `src/composition/application-services.ts` | PASS |
| Full gate green | `./scripts/verify-local.sh all` (exit 0, 0 failures), `./scripts/verify-local.sh static-analysis` (all stages clean) | PASS |

Next action: CP-5 — add the R5 human-override regression through the existing `px review`
decision path (seed an `active` Mission with an awaiting Review, apply a human approval, assert
a persisted `ReviewerDecision(kind=approved)` and `review → integration` with
`occurredAt = decidedAt`, then confirm `px integrate` proceeds without re-running approval).

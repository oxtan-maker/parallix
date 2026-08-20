# CP 2 — Inventory + invariant proof

## Summary

Traced and classified every approval producer, persistence call site, the
`defaultUserApproved` flow, the recovery entry point, the stats derivation
caller graph, and every external-inference reader. Proved the Review-aggregate
invariant from the domain.

### Approval producers (every supported way a Review becomes `approved`)

| # | Producer | Decision persisted through | `review → integration` boundary fires? (baseline) |
|---|---|---|---|
| 1 | Provider-backed reviewer decision (review loop artifact consumption, `consumeReviewerArtifacts`) | bound `writeReviewState` (`src/adapters/review/review-artifacts.ts`) | Yes — `ReviewState.save` boundary, `occurredAt = decidedAt` |
| 2 | Provider-backed post (`postWorkflowReview` + local state write in `applyReviewOutcome`) | bound `writeReviewState` (`src/adapters/review/review-commands.ts`) | Yes |
| 3 | provider=none / local outcome (`px review --submit-review approve`) | bound `writeReviewState` (`applyReviewOutcome`, `src/adapters/review/review-commands.ts`) | Yes |
| 4 | Self/local approval (self-author POST skip persists locally) | same path as 3 | Yes |
| 5 | Automated/artifact review producing a real `ReviewerDecision` (`recordRequestedChanges` / `recordImplementerResolution` in `src/adapters/review/review-round.ts`) | bound `writeReviewState` | Yes (request-changes boundary; approval via 1–3) |
| 6 | **Human override = `defaultUserApproved`** (repo default user approved on the provider) | **nothing — integrate-preflight boolean only** (`getLatestReviewDecision` in `src/adapters/forgejo/forgejo-pr.ts` → `context.approval` → `evaluateTaskStatusForIntegration` / `printIntegrationPreflight` in `src/adapters/cli/commands/integrate.ts`) | **No — the bypass. No `ReviewerDecision` persisted, no transition, no `decidedAt` plumbed (the approval's `submitted_at` is never returned).** This is the red-repro producer confirmed in CP 1. |
| 7 | `submitForReview` (handoff operation) | creates the awaiting Review aggregate (`active → review`) | n/a — creates no decision |

Boundary owner: `ReviewState.save` in `src/adapters/review/review-state.ts`
(fires when `lifecycleService` is supplied and phase becomes `approved`,
`occurredAt = ReviewerDecision.decidedAt`, else round `startedAt`).

### `bindReviewPersistence` call sites

- `src/composition/create-cli.ts:188` — `px review`: bound with store + lifecycle. OK.
- `src/composition/create-cli.ts:462` — `review-event` command:
  `bindReviewPersistence(services.mission.store)` — **no lifecycle service**
  (second baseline candidate; `createEvent` persists no approval, but the site
  is unbound per the mission scope and gets the lifecycle service in CP 3).
- Test-only: `test/task-2339-review-store-bindings.test.ts`,
  `test/task-2376-lifecycle-timing.test.ts`,
  `test/task-2378-authoritative-stats.test.ts`.

### `defaultUserApproved` boolean flow

`getLatestReviewDecision` (forgejo-pr.ts) computes `defaultUserApproved`
(default-user `APPROVED` review exists) but drops the approval's
`submitted_at`. `buildIntegrationContext` (integrate.ts) copies it into
`context.approval`. Consumers: `evaluateTaskStatusForIntegration` (preflight
accepts `review` + `defaultUserApproved` without an `APPROVED` state — the
boolean acting as approval authority) and `printIntegrationPreflight`
(WARN/FAIL branches). `recoverMissionForIntegration` never reads it — so an
override never becomes a `ReviewerDecision` and recovery of a
review-without-decision aborts (the CP 1 red).

### `recoverMissionForIntegration` (integrate.ts)

- `done` → idempotent closeout, no event. `integration` → passthrough.
- `active` + Review facts → `submitForReviewFn` (existing handoff operation) → `approve` transition @ `decidedAt`.
- `active` + no Review → abort (even with override — CP 4 adds the R5 chain).
- `review` + approved decision → `approve` transition @ `decidedAt`.
- `review` + no approved decision → abort (even with override — CP 4 adds the override path).

### `deriveImplementerAndFixRounds` caller graph

- `createStatsWorkflowAdapter` (stats.ts port impl) ← `src/composition/create-cli.ts:231` passes `services.mission?.store ?? null` — **the null-wiring defect (SC13/AC21/AC22)**; signature `MissionStore | null` accepts it.
- `recordIntegrationStats` (stats.ts) — throws the invariant error without a store; production callers `integrate.ts:433,606` pass `missionServices.store`. OK.
- `stats-backfill.ts:242` — historical-mission backfill tool; carries its own git-history implementer/date fallback for pre-cutover missions. **Classified out of scope** per mission Out-of-Scope ("Historical SQLite measurement repair, migration, or backfill of pre-cutover missions"); not one of the four named helpers.
- Tests: `test/stats.test.ts`, `test/task-2347.10-repro.test.ts`, `test/task-2348-implementer-attribution.test.ts`, `test/stats-backfill.test.ts`, `test/task-2376-lifecycle-timing.test.ts`, `test/task-2378-authoritative-stats.test.ts`, `test/stats-command-use-case.test.ts`.

### External-inference readers

The four named helpers (`deriveImplementerAndFixRoundsFromPrComments`,
`deriveFinalImplementerFromBranchHistory`, `deriveFixRoundsFromReviewStateHistory`,
`deriveFixRoundsFromTaskText`) are **already deleted** — repo-wide search finds
zero definitions or callers. Residual git-history reads exist only in
`stats-backfill.ts` (historical tool, classified out of scope above) and for
non-review facts (date, classification). No PR-comment, branch-history,
review-state-history, or backlog-task-text inference of implementer/fixRounds
remains in the contemporary stats path.

### Invariant proof: `integration` requires a Review aggregate

From `src/domain/mission-workflow.ts` (`decideMission`), the only command that
sets `status: 'integration'` is `approve`:

- `requireStatus(mission, ['review'])` — the mission must already be in `review`.
- `requireSameReviewedRevision(mission, command.review)` — throws when
  `!mission.review` ("Review decision must preserve the exact reviewed
  revision"); the command's review must match the stored aggregate's revision.
- `reviewStatus(command.review) !== 'approved'` → `MissionRuleViolation`.

`review` itself is only reachable via `submit-for-review`, which stores the
Review aggregate on the mission (`{ ...mission, status: 'review', review:
command.review }`) after validating `awaiting-review`, reviewer eligibility,
and a real reviewed change. `integrate` requires `integration`. Therefore a
normal Mission **cannot** reach `integration` without a Review aggregate.
No supported workflow violating this exists — **no stop rule triggered**.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every approval producer traced and classified | `src/adapters/review/review-artifacts.ts`, `src/adapters/review/review-commands.ts`, `src/adapters/review/review-round.ts`, `src/adapters/forgejo/forgejo-pr.ts`, `src/adapters/cli/commands/integrate.ts`; regression `test/task-2378-authoritative-stats.test.ts` ("R5: human px review approval persists ReviewerDecision and lands integration at decidedAt without a second approval") pins the bound producers | PASS |
| The one bypassing producer identified (`defaultUserApproved`) | `test/task-2379-approval-boundary-repro.test.ts` (red at parent `7b42e7f86`); `getLatestReviewDecision` in `src/adapters/forgejo/forgejo-pr.ts` | PASS |
| `bindReviewPersistence` call sites inventoried; unbound site found | `src/composition/create-cli.ts` (review command bound; `review-event` site unbound), `src/composition/review-persistence.ts`; `test/task-2339-review-store-bindings.test.ts` | PASS |
| Invariant proven: no `integration` without Review aggregate | `decideMission` in `src/domain/mission-workflow.ts` (`approve` is the sole producer of `integration` and requires the stored aggregate); pinned by `test/task-2376-lifecycle-timing.test.ts` ("R8: direct review → done forbidden — integrate requires integration status") | PASS |
| External-inference readers inventoried; named helpers already deleted | repo-wide search for the four helper names → 0 hits; residual git-history reads confined to `src/adapters/cli/commands/stats-backfill.ts` (historical backfill, out of scope); `test/review-stats.test.ts` | PASS |
| `deriveImplementerAndFixRounds` caller graph mapped; null-wiring defect located | `src/composition/create-cli.ts` (stats wiring `?? null`), `src/adapters/cli/commands/stats.ts`, `src/adapters/cli/commands/integrate.ts` (post-integration stats with store); `test/task-2378-authoritative-stats.test.ts` ("live stats workflow adapter derives authoritative implementer and reviewFixRounds from the Review aggregate") | PASS |
| No stop rule triggered | no workflow reaches `integration` without a Review aggregate; no named helper has an un-inventoried production caller | PASS |

Next action: CP 3 — boundary convergence (Parts A/B/E): make the human override persist a real `ReviewerDecision(kind=approved, decidedAt=T)` through the Review domain (plumbing the approval's `submitted_at` as `defaultUserApprovedAt`), keep Backlog promotion strictly after the durable transition, and bind the remaining `review-event` persistence site with the lifecycle service.

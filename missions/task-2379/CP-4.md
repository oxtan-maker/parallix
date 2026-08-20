# CP 4 — Recovery orchestration (Parts C/D/F)

## Summary

Verified `px integrate` is a recovery/orchestration command only: it
reconciles stale `active` / `review` / `integration` states by invoking the
existing workflow operations in sequence, timestamps recovered transitions
with the stored `ReviewerDecision.decidedAt`, never invents transitions, and
stops clearly when authoritative facts are missing. The `done` resume and
`integration` passthrough remain unchanged.

Recovery matrix as implemented in `recoverMissionForIntegration`
(`src/adapters/cli/commands/integrate.ts`):

| Starting state | Authoritative facts | Recovery behavior | Pinned by |
|---|---|---|---|
| `active` | Review facts present | existing `submit-for-review` operation, then `approve` @ `decidedAt` | `test/integrate.test.ts` "R4: stale active recovery chains submit-for-review then approve with original decidedAt" |
| `active` | no Review + explicit human override | existing `submit-for-review` operation creates the awaiting aggregate; override persisted as real `ReviewerDecision` via the Review domain; `approve` @ `decidedAt` | `test/integrate.test.ts` "R5: stale active recovery with human override persists a real ReviewerDecision, then chains existing operations" |
| `active` | no Review, no override | abort with actionable error; Mission not `done`; no transition invented | `test/integrate.test.ts` "recovery refuses an active Mission without authoritative Review facts", "R6: stale active without Review facts and without override stops — Mission not done" |
| `review` | approved decision stored | existing `approve` transition @ stored `decidedAt` (never integration start time) | `test/integrate.test.ts` "recovery promotes an approved Review with its original decidedAt before integration"; `test/task-2379-approval-boundary-repro.test.ts` "delayed integration: review dwell is 30m and integration dwell is 225m (R2)" (override variant, end-to-end) |
| `review` | unapproved, no override | abort; Mission remains `review` | `test/integrate.test.ts` "R7: review without approval stops — Mission remains review" |
| `integration` | — | passthrough; no re-run of review/approval, no duplicate approval event | `test/integrate.test.ts` "R9: normal integration state proceeds without rerunning approval" |
| `done` | — | idempotent closeout; no duplicate lifecycle events | `test/integrate.test.ts` "persistLandedIntegrationOrAbort records lifecycle completion and closure" |

Part D compliance: recovery never assigns `Mission.status` and never
duplicates domain rules — every lane change goes through
`submitForReviewFn` (the existing handoff operation) or
`missionServices.lifecycle.transition` / the integration service; the
domain/application layer keeps deciding validity. Part F compliance: the
recovered `approve` transition uses `occurredAt: reviewRound.decision.decidedAt`
(existing) or the override's own `defaultUserApprovedAt` (new); `new Date()`
is not used for any recovered historical transition.

No behavior change was needed in this checkpoint beyond the CP 3 wiring: the
full matrix re-ran green against the committed tree.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `px integrate` recovers stale `active`/`review`/`integration` via existing operations (SC3/SC4/SC9) | `test/integrate.test.ts`: "R4: stale active recovery chains submit-for-review then approve with original decidedAt", "recovery promotes an approved Review with its original decidedAt before integration", "R9: normal integration state proceeds without rerunning approval" | PASS |
| Override recovery persists a real `ReviewerDecision` then chains existing operations (SC5) | `test/integrate.test.ts` "R5: stale active recovery with human override persists a real ReviewerDecision, then chains existing operations" | PASS |
| Missing authoritative facts stop clearly, Mission not done (SC6/SC7) | `test/integrate.test.ts` "R6: stale active without Review facts and without override stops — Mission not done", "R7: review without approval stops — Mission remains review", "recovery refuses an active Mission without authoritative Review facts" | PASS |
| Recovered transition timestamped by stored `decidedAt`, never `new Date()` (SC3, Part F) | `test/task-2379-approval-boundary-repro.test.ts` ("delayed integration: review dwell is 30m and integration dwell is 225m (R2)" — persisted event `occurred_at = 2026-01-01T10:30:00Z`); `test/task-2376-lifecycle-timing.test.ts` "R3: stale review recovery uses ReviewerDecision.decidedAt for approve transition" | PASS |
| Exactly one `integration → done` at landed commit time; failed landing never creates done (SC3/SC9) | `test/task-2379-approval-boundary-repro.test.ts` (asserts one `integrate`-triggered done event @ 14:15); `test/integrate.test.ts` "persistLandedIntegrationOrAbort records lifecycle completion and closure"; `persistLandedIntegrationOrAbort` in `src/adapters/cli/commands/integrate-post.ts` | PASS |
| No shortcuts / no reimplemented transition rules (SC17, Part D) | `recoverMissionForIntegration` in `src/adapters/cli/commands/integrate.ts` invokes only `submitForReviewFn` + `lifecycle.transition`; domain invariants in `src/domain/mission-workflow.ts` | PASS |
| Full integration suite green | `node --experimental-test-module-mocks --import tsx --test test/integrate.test.ts` → 75/75 | PASS |

Next action: CP 5 — domain hardening (Part G): confirm the `integrate` command requires `Mission.status = integration` only, direct `review → done` is a `MissionRuleViolation`, and re-run the R4–R9 recovery regressions.

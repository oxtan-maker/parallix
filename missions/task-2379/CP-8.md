# CP 8 — Lifecycle statistics proof (Part M)

## Summary

Ran the persisted projection of the 10:00 / 10:30 / 14:00 / 14:15 fixture and
asserted the exact dwell split. No code changes were required — the boundary
convergence (CP 3), recovery orchestration (CP 4), and domain hardening
(CP 5) already make the persisted lane events carry the authoritative
timestamps, and the Board/FLOW projection reads them unchanged.

### The proof

`test/task-2379-approval-boundary-repro.test.ts`
("delayed integration: review dwell is 30m and integration dwell is 225m (R2)")
drives the fixture through the real lifecycle services over a migrated SQLite
operator database:

1. **10:00** — the mission enters review through the existing
   `submit-for-review` transition (`occurredAt = 10:00`).
2. **10:30** — the repo default user approved on the provider earlier; the
   integrate context carries that override fact with its own timestamp.
3. **14:00** — `recoverMissionForIntegration` observes the late approval,
   persists it as a real `ReviewerDecision` at its own timestamp, and runs
   the existing approve transition **at `decidedAt = 10:30`** — never at the
   14:00 integration start.
4. **14:15** — `decideIntegration` lands the commit; exactly one
   integration→done event at the landed commit time.

It then reads the **persisted** `board_lane_events` back out of SQLite and
feeds the same projection Board/FLOW consumes (`medianCycleTimeByStateSeries`):

- review dwell = **30m** (10:00 → 10:30),
- integration dwell = **225m** (10:30 → 14:15).

A retry-time stamp would shift the split (review 30m / integration 240m or
worse), so the exact 30/225 assertion pins the boundary stamping end to end.
The projection's public behavior is unchanged — it receives the same lane
event shape it always did; only the timestamps became authoritative.

### Supporting timing/completion certification

The same run also re-certified the surrounding lifecycle timing semantics:
R1 (boundary stamping at `decidedAt`, incl. the production local-approval
path), R2 + sensitivity (delayed dwell split follows the real boundary
events), R3 (stale recovery uses `decidedAt`), R8 + sensitivity (direct
review→done forbidden; integrate requires integration status) — 87/87 across
`test/task-2376-lifecycle-timing.test.ts`, the repro file, and
`test/integrate.test.ts`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Persisted projection of the fixture asserts review dwell = 30m | `test/task-2379-approval-boundary-repro.test.ts` "delayed integration: review dwell is 30m and integration dwell is 225m (R2)" — reads `board_lane_events` from SQLite and asserts `reviewDwell.value === 30` via `medianCycleTimeByStateSeries`; passes | PASS |
| Persisted projection asserts integration dwell = 225m | same test — `integrationDwell.value === 225` (10:30 approval → 14:15 landed commit); passes | PASS |
| review→integration persisted at the approval's own timestamp, not retry time | same test — exactly one review→integration lane event with `occurredAt = APPROVED_AT` (10:30) despite the 14:00 integrate run; `test/task-2376-lifecycle-timing.test.ts` "R2: delayed integration dwell — review 30m, integration 225m" | PASS |
| Projection public behavior unchanged | the repro consumes `medianCycleTimeByStateSeries` over the standard lane-event shape; no projection API changes in the mission diff (`git diff f23a1ea56..HEAD -- src/application/projections/` is empty for dwell semantics) | PASS |
| Surrounding timing/completion semantics certified | `test/task-2376-lifecycle-timing.test.ts` "R1: normal approval transitions review to integration immediately with decidedAt", "R2 sensitivity: wall-clock approve shifts dwell from 30m/225m to 240m/15m", "R3: stale review recovery uses ReviewerDecision.decidedAt for approve transition", "R8: direct review → done forbidden — integrate requires integration status" — all pass (87/87 combined run) | PASS |
| Full verifier still green | `npm test` → 1938/1938 pass (committed tree); `./scripts/verify-local.sh static-analysis` → ALL STAGES PASSED | PASS |

Next action: CP 9 — Contradiction + dead-code sweep: rerun the backlog's contradiction-pattern searches over the committed tree, classify every hit, delete orphans, and confirm final semantics.

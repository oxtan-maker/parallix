# CP-3: Focused tests added and gates green

## Summary

Added `test/mission-activity.test.ts` (22 tests) covering the shared projection and both operator renderings, and ran the mission's declared gates.

Coverage added:
- Projection: live / unconfirmed / stale authoritative work, blocked work with its reason, idle work; coordinator evidence `live` (with and without an attributed family), `stopped` (scan ran, nothing found) and `unknown` (scan could not run), including preservation through `projectMissionCard`; overlapping-operation determinism driven through `reconcileCurrentWork`; `summarizeMissionActivity` totals.
- TUI (`AgentStrip`): live authoritative work rendered separately from coordinator evidence, recovery-only live coordinator evidence, unknown evidence, and stale/blocked/idle work in the `work:` summary; plus a negative assertion that no frame matches `/\d+ running/`.
- CLI (`renderStatus`): the same six states as `Mission work:` / `Coordinator evidence:` lines, plus a negative assertion that no status line mentions "running".

One follow-up from the gate: `StatusMissionData.activity` was made optional (`activity?: MissionActivity | null`) so existing status test doubles in `test/status-command-use-case.test.ts` stay valid; `renderStatus` already treats an absent projection as "state nothing about activity", which is the truthful behavior.

The earlier revision of this checkpoint reported `test/status.test.ts` as blocked by Node 24. That was a missing runner flag, not a runtime incompatibility: the suite passes `--experimental-test-module-mocks` (see `test/lib/test-run-plan.ts`), and `npx tsx --test --experimental-test-module-mocks test/status.test.ts` passes 14/14.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| The shared mission-activity projection exposes authoritative operation work separately from coordinator-process recovery evidence, with distinct `live`, `unknown`, `stale`, and `stopped` states | `src/application/projections/mission-activity.ts`; tests `"projectMissionActivity reports live authoritative work with live certainty"`, `"projectMissionActivity reports an unverifiable work fact as unconfirmed, never as idle"`, `"projectMissionActivity keeps a stale work fact visible and marked stale"`, `"projectMissionActivity separates an observed-stopped coordinator from an unobserved one"`, and `"projectMissionCard preserves unobserved coordinator liveness for mission activity"` in `test/mission-activity.test.ts` | PASS |
| `agent-strip.tsx` never renders coordinator-process evidence as an exact running-agent count; its live-coordinator rendering identifies the evidence as an active px command or uses authoritative mission-work wording | `"AgentStrip renders live authoritative work separately from coordinator evidence"` and `"AgentStrip reports observed live px commands per family without calling them agents"` (both assert `!/\d+ running/`) in `test/mission-activity.test.ts` and `test/agent-strip.test.ts`; strip text comes from `describeFamilyCoordinatorEvidence` | PASS |
| For a selected mission, `px status` renders the same authoritative-work state and coordinator-evidence lifecycle/uncertainty state consumed by the TUI | `"px status renders live authoritative work and live coordinator evidence as separate facts"`, `"px status reports unknown coordinator evidence when liveness was not observed"`, `"px status reports stale authoritative work as stale rather than dropping it"` in `test/mission-activity.test.ts`; both surfaces call `describeMissionWork`/`describeCoordinatorEvidence` from `src/application/projections/mission-activity.ts` | PASS |
| The projection defines deterministic output for overlapping operations and unattributed families without overwriting or claiming an exact agent count | `"projectMissionActivity restates the one operation the reconciler resolved for overlapping operations"` and `"projectMissionActivity leaves an unattributed coordinator family null instead of guessing one"` in `test/mission-activity.test.ts`; upstream resolver `resolveOperation` in `src/application/projections/current-work.ts`; existing `test/task-2375-active-invocation-overlap.test.ts` | PASS |
| Focused rendering tests cover live authoritative work, recovery-only live coordinator evidence, unknown evidence, stale evidence, blocked work, and idle work in both the TUI and status CLI paths | `test/mission-activity.test.ts` (21 tests, TUI section `AgentStrip renders …` and CLI section `px status …`); `npx tsx --test test/mission-activity.test.ts` reports 21 pass / 0 fail | PASS |
| `./scripts/verify-local.sh static-analysis` passes; if any user-facing terminology changes in authored documentation, `./scripts/verify-local.sh docs` also passes | `./scripts/verify-local.sh static-analysis` — all 4 stages PASS; `./scripts/verify-local.sh docs` — PASS (`docs/agents.md` strip sample and the new "Mission activity in `px status`" section); `./scripts/verify-local.sh all` — exit 0, 1978 pass / 0 fail | PASS |

Next action: hand off for review; no further projection, consumer, test, or gate work is outstanding for task-2389.

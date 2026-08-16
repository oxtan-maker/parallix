# CP-5 — Harden integrate domain rule to integration-only

## Summary

Changed `decideMission` `integrate` case from `requireStatus(mission, ['review', 'integration'], command)` to `requireStatus(mission, ['integration'], command)`. The `review → done` shortcut is now a `MissionRuleViolation`. Recovery (CP-4) transitions `review → integration` via the `approve` operation before `decideIntegration` runs, so the new rule is satisfied for all recovery paths.

Updated `test/domain-mission.test.ts` — `integrate` from `review` status now throws `MissionRuleViolation` instead of succeeding. Updated `test/task-2376-lifecycle-timing.test.ts` R8 sensitivity test — documents that the shortcut no longer exists (asserts `MissionRuleViolation` instead of asserting `done`).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `integrate` command requires `integration` status only | `src/domain/mission-workflow.ts` `requireStatus(mission, ['integration'], command)` | PASS |
| `review → done` shortcut throws `MissionRuleViolation` | `test/domain-mission.test.ts` `"mission lifecycle rejects unsupported jumps and missing handoff evidence"`; `test/task-2376-lifecycle-timing.test.ts` `"R8: direct review → done forbidden — integrate requires integration status"` | PASS |
| R8 sensitivity confirms shortcut is eliminated | `test/task-2376-lifecycle-timing.test.ts` `"R8 sensitivity: review → done shortcut skips integration lane"` | PASS |
| Recovery still works (approve transitions to integration before integrate) | `npm test -- test/integrate.test.ts` — 69 tests pass including `"recovery promotes an approved Review with its original decidedAt before integration"` | PASS |
| All lifecycle timing tests pass (R1-R3, R8) | `npx tsx --test test/task-2376-lifecycle-timing.test.ts` — 6/6 pass | PASS |
| Domain tests pass | `npx tsx --test test/domain-mission.test.ts` — 17/17 pass | PASS |
| Type check passes | `npx tsc --project tsconfig.test.json --noEmit` | PASS |

Next action: CP-6 — delete obsolete stats inference helpers (PR/Git/task-text fallback) and fix callers to provide authoritative MissionStore.

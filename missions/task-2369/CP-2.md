# CP-2 — Part A + Part B: one completion owner

## Summary

Removed the premature Mission completion from backlog promotion
(`promoteTaskForIntegrationIfNeeded()` in `src/adapters/cli/commands/integrate.ts`).
The `missionServices.lifecycle.transition({ command: { type: 'integrate' } })`
call is deleted; promotion now performs `review -> approved` on the Backlog
representation only.

The fail-closed mission-store read is **kept**: an unavailable or missing
aggregate still refuses the external Backlog effect, so promotion never mutates
a task file whose durable counterpart cannot be confirmed. Only the lifecycle
side effect is gone.

Part B needed no change — the post-landed path
(`persistLandedIntegrationOrAbort()` → `MissionIntegrationService.decideIntegration()`
→ `integration -> done`) was already the desired model and is now the *only*
path that can produce `done`.

Why R1 was red before this change: `decideMission` maps the `integrate` command
from `review` to `done` (`src/domain/mission-workflow.ts`, `case 'integrate'`).
Promotion runs at integrate Step 4, before the squash commit at Step 5, so a
commit that never landed still left the Mission `done`. R3 was red for the
mirror reason: promotion consumed the transition, and a `review -> done` move
produces no lane event at all (`triggerFromTransition` only maps
`integration -> done`), so the `integration -> done` event count was 0.

Contradiction sweep for this checkpoint: `grep -rn "command: { type: 'integrate' }" src/ test/`
returns exactly one match — a comment in `test/task-2369-regressions.test.ts`
documenting the removed behavior. The only remaining producer of the `integrate`
command is `MissionIntegrationService.decideIntegration()`, which builds it
directly as `decideMission(loaded.mission, { type: 'integrate' })`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC01/AC03 promotion cannot transition the Mission into done | `test/task-2369-regressions.test.ts`, `"R1: backlog promotion cannot complete the Mission when landing fails"` | PASS |
| AC04 promotion owns only Backlog/task semantics | `src/adapters/cli/commands/integrate.ts`, `promoteTaskForIntegrationIfNeeded()` — no `lifecycle.transition` call remains; `grep -rn "command: { type: 'integrate' }" src/` returns no source match | PASS |
| SC02/AC05/AC06 exactly one production completion path | `MissionIntegrationService.decideIntegration()` reached only from `persistLandedIntegrationOrAbort()`; `grep -n "decideIntegration" src/adapters/cli/commands/integrate.ts` shows one call site | PASS |
| AC07/AC08 completion only after the commit exists; failed landing leaves it incomplete | `test/task-2369-regressions.test.ts`, `"R1: backlog promotion cannot complete the Mission when landing fails"` | PASS |
| SC13/AC09/AC11 approved integration completes once and a retry stays one | `test/task-2369-regressions.test.ts`, `"R2: an approved normal integration completes exactly once and a retry stays at one"` | PASS |
| SC14/AC10 review-origin integration completes once, after landing | `test/task-2369-regressions.test.ts`, `"R3: a review-origin integration completes only after the commit has landed"` — asserts the order `['promoted', 'landed', 'completed', 'stats']` | PASS |
| Existing integrate coverage unaffected | `npm test -- test/integrate.test.ts test/task-1039-integrate-v3.test.ts test/task-2367-regressions.test.ts test/task-2367-integration-completion-repro.test.ts test/integrate-guard.test.ts` — 81 pass, 0 fail | PASS |
| Fail-closed promotion guard preserved | `test/integrate.test.ts`, `"promoteTaskForIntegrationIfNeeded refuses to promote the Backlog task when the Mission aggregate is ..."` | PASS |

Next action: CP-3 — resolve the landed commit's own timestamp inside `persistLandedIntegrationOrAbort()` (`git show -s --format=%cI <landedCommit>`, not `git log -1`/HEAD) and pass it as `occurredAt` to `decideIntegration()`, so both the normal and the resumed caller share one timestamp resolution; then confirm both R4 regressions turn green.

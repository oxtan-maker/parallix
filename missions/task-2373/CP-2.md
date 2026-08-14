# CP-2 — Current work through the autonomous review loop, one shared seam, ordered writes (SC2–SC7)

## Summary of work done

One publication seam, `agentLaunchPublisher()` in
`src/application/recording/current-work-recorder.ts`, now builds the callback that publishes
every agent the review loop launches. Both entry points use it and nothing else builds one:

- `ReviewCommandUseCase` (direct `px review`) replaced its inline `onAgentLaunched` closure
  with the seam.
- `ExecuteMissionService` passes the same seam into `HandoffReviewPort.runHandoffAndReview`,
  so autonomous review started by `px active` publishes the reviewer and the implementer
  answering findings under the mission's own `operationId`.
- `HandoffReviewAdapter` forwards `onAgentLaunched` verbatim into
  `runHandoffAndReview`, which hands it to `startReviewLoop`; the loop already awaits
  `onLaunch` for every reviewer and implementer launch.

Authoritative writes are now awaited rather than dropped: `AgentLaunchRequest.onAgentChanged`
returns `Promise<void>`, `ExecuteMissionService.launchAgent` returns the publish promise
instead of `void`-ing it, and `selectLaunchAndRecord`'s `onLaunch` awaits the callback.

Review escalation keeps its reason: a review operation that throws now publishes `blocked`
with the error text before rethrowing, instead of the reason-free `ended` fact the `finally`
block used to write.

Behaviour change to an existing test: `"a failing review operation stops claiming work and
keeps its reason"` in `test/current-work-publication.test.ts` (renamed from `"…still clears
its current work"`) now asserts `blocked` + reason. `test/execute-mission-adapters.test.ts`
asserts the seam is forwarded unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2 — current work follows reviewer/implementer launches after handoff | `test/task-2373-current-work-workflow.test.ts`, `"SC2: current work follows reviewer and implementer launches after handoff instead of the original implementer"` | PASS |
| SC3 — reviewer publishes review phase; implementer publishes review-response | `test/task-2373-current-work-workflow.test.ts`, `"SC3: reviewer launches publish a review phase and implementer launches publish review-response"` | PASS |
| SC4 — three or more review rounds each update the same mission | `test/task-2373-current-work-workflow.test.ts`, `"SC4: three consecutive review rounds each update the same mission current work"` | PASS |
| SC5 — one application seam for `px review` and `px active`, no downstream inference | `test/task-2373-current-work-workflow.test.ts`, `"SC5: px review and px active publish nested review work through one seam"` — asserts identical facts from both entry points, exactly one `agentLaunchPublisher(` call site per caller, and no `review-response` inference in `board-readers.ts`, `board.ts`, `shell.tsx`, `ui-command.ts` | PASS |
| SC6 — `claude -> usage blocked -> qwen` stays WORKING with no attention | `test/task-2373-current-work-workflow.test.ts`, `"SC6: claude blocked by usage limits and replaced by qwen keeps the mission WORKING throughout"` | PASS |
| SC7 — failover/selection writes are awaited and ordered | `test/task-2373-current-work-workflow.test.ts`, `"SC7: a delayed current-work publication lands before the next state is read"`; red companion `test/task-2373-repro.test.ts`, `"TASK-2373 defect 2: an agent-change publication is awaited before the run reads later state"` | PASS |
| SC1 defect 1 now green | `test/task-2373-repro.test.ts`, `"TASK-2373 defect 1: px active publishes the agents launched inside the autonomous review loop"` | PASS |
| SC1 defect 4 now green (SC10 groundwork) | `test/task-2373-repro.test.ts`, `"TASK-2373 defect 4: a review loop that cannot continue publishes its blocking reason"` | PASS |
| No new run/attempt aggregate introduced | `test/domain-attempt-guard.test.ts` passes in the suite run below; the seam publishes onto the existing `mission.current-work` event type | PASS |
| Adapter forwards the seam without interpreting it | `test/execute-mission-adapters.test.ts`, `"handoff review adapter forwards the resolved task file and returns the pipeline verdict"` | PASS |
| Typecheck clean | `npm run typecheck`, `npx tsc --noEmit --project tsconfig.test.json` — no output | PASS |

Remaining known-red at this checkpoint (owned by CP-3 and CP-8, red on purpose):
`"TASK-2373 defect 3: …"` (both) and `"TASK-2373 defect 5: …"` in `test/task-2373-repro.test.ts`,
and `"TASK-2373 defect 6: q terminates a real px board while a confirmation dialog is armed"`
in `test/task-2373-shutdown.test.ts`.

Next action: CP-3 — make reconciliation operation-aware in
`src/application/projections/current-work.ts`: match terminal events by `operationId` and
order same-operation events by the operational store's durable row sequence, turning both
defect-3 tests green (SC8–SC9).

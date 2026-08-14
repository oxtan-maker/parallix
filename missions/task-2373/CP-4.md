# CP-4 — Truthful NEEDS YOU projection (SC10–SC12)

## Summary of work done

The reason a review loop gives up now reaches the operator instead of dying with the loop.

- The CP-2 seam grew a second callback and became `reviewLoopPublisher()` in
  `src/application/recording/current-work-recorder.ts`, returning
  `{ onAgentLaunched, onAutonomousStop }`. It is still **one** seam spread into the loop
  options by both `ReviewCommandUseCase` and `ExecuteMissionService`.
- `startReviewLoop` calls `onAutonomousStop(reason)` from `escalateToHumanReview` (reviewer
  launch failure, artifact-retry exhaustion, non-approval) and from the
  `BLOCKED`/`PARKED` implementer disposition. `ReviewWorkflowAdapter` and
  `runHandoffAndReview` forward it; `HandoffReviewRequest` carries it.
- `resolveOperation` in `src/application/projections/current-work.ts` was extended in place:
  a `blocked` fact is not overwritten by the same operation's bracket-closing `ended`. Only
  new `running` work clears it. That is what stops the reason from being discarded when the
  operation finishes normally after escalating.

Recoverable failover is untouched: it publishes `running` with the new family, never
`blocked`, so it cannot create attention.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC10 — review escalation projects its reason into the operator-facing blocking reason | `test/task-2373-needs-you.test.ts`, `"SC10: review-loop escalation during px active leaves the mission in NEEDS YOU with its reason"` | PASS |
| SC10 — the reason is not discarded when current work ends | `test/task-2373-needs-you.test.ts`, `"SC10: the bracket-closing ended fact cannot erase an escalation reason"` | PASS |
| SC11 — exhausted options survive into NEEDS YOU | `test/task-2373-needs-you.test.ts`, `"SC11: exhausted execute options survive into NEEDS YOU as the operator-facing reason"` | PASS |
| SC11 — a single usage-blocked family with another eligible creates no attention | `test/task-2373-needs-you.test.ts`, `"SC11: one family becoming usage-blocked while another can take over creates no attention"`; also `test/task-2373-current-work-workflow.test.ts`, `"SC6: claude blocked by usage limits and replaced by qwen keeps the mission WORKING throughout"` | PASS |
| SC12 — four states stay mutually truthful | `test/task-2373-needs-you.test.ts`, `"SC12: active work, failover, exhaustion, and dead work each project one truthful state"` | PASS |
| Escalation is published where it happens, not inferred downstream | `src/adapters/review/review-loop.ts` — `escalateToHumanReview` calls `onAutonomousStop`; the SC5 structural assertion in `test/task-2373-current-work-workflow.test.ts` still forbids inference in `board-readers.ts`, `board.ts`, `shell.tsx`, `ui-command.ts` | PASS |
| Adapter forwards both callbacks untouched | `test/execute-mission-adapters.test.ts`, `"handoff review adapter forwards the resolved task file and returns the pipeline verdict"` | PASS |
| `AgentBlock` remains the availability authority | `test/current-work-publication.test.ts`, `"publishing current work writes only operational history and touches no other authority"` | PASS |
| Typecheck clean | `npm run typecheck`, `npx tsc --noEmit --project tsconfig.test.json` — no output | PASS |

Suite state: `npm test` fails only on the two intentionally-red characterization tests owned
by CP-7 and CP-8 (`"TASK-2373 defect 5: …"`, `"TASK-2373 defect 6: q terminates a real px
board while a confirmation dialog is armed"`).

Next action: CP-5 — harden current-work liveness in
`src/application/projections/current-work.ts` and its process probe so a reused PID with a
different process-start identity is treated as dead, and abnormal termination still ages out
(SC13–SC14).

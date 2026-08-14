# CP-1 — Red characterization tests for all six defects (SC1)

## Summary of work done

Added failing characterization tests for each of the six defects named in SC1, written
against the production seams so they fail on the parent commit and will pass only once the
defect itself is closed.

- `test/task-2373-repro.test.ts` — five in-process defects (nested review reporting,
  fire-and-forget agent-change publication, old-operation terminal events, lost review
  escalation reason, unbounded current-work history read).
- `test/task-2373-shutdown.test.ts` — the shutdown defect, exercised on a **real spawned
  `px board` process under a local PTY**. The harness now publishes the launched process's
  own pid (`sh -c 'echo $$ …; exec …'`), so the assertion is "that pid is gone", not "a
  callback ran".
- `test/helpers/pty-smoke-harness.ts` — extended the existing harness in place with `pid`,
  `signal()`, `waitForExit()`, `processGone()`, `terminalRestored()`, and `cleanup()`. No
  second harness was created; `test/tui-pty-smoke.test.ts` still passes unchanged.
- `src/application/recording/current-work-recorder.ts` — added the optional `sequence`
  field to `CurrentWorkEvent` (type only, no behaviour) so the durable-ordering test can be
  expressed. Reconciliation still ignores it, which is why that test is red.

Baseline before any change: `npm test` → 2256 tests, 2256 pass, 0 fail.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — nested autonomous review reports wrong phase/agent | `test/task-2373-repro.test.ts`, `"TASK-2373 defect 1: px active publishes the agents launched inside the autonomous review loop"` — fails: `typeof request.onAgentLaunched` is `undefined`; `HandoffReviewRequest` in `src/application/ports/execute-mission.ts` carries no publication seam | RED (expected) |
| SC1 — asynchronous agent-change publication races later state | `test/task-2373-repro.test.ts`, `"TASK-2373 defect 2: an agent-change publication is awaited before the run reads later state"` — fails: `onAgentChanged` returns `undefined` because `ExecuteMissionService.launchAgent` uses `void this.publishWork(...)` | RED (expected) |
| SC1 — terminal event from older work clears newer work | `test/task-2373-repro.test.ts`, `"TASK-2373 defect 3: a terminal event from an older operation does not clear newer current work"` — fails: `reconcileCurrentWork` is newest-timestamp-wins and has no `operationId` matching | RED (expected) |
| SC1 — same-operation ordering under equal timestamps (SC9 precursor) | `test/task-2373-repro.test.ts`, `"TASK-2373 defect 3: same-operation replacement is deterministic under identical timestamps"` — fails: reconciliation ignores the store's durable sequence | RED (expected) |
| SC1 — review escalation loses its blocking reason | `test/task-2373-repro.test.ts`, `"TASK-2373 defect 4: a review loop that cannot continue publishes its blocking reason"` — fails with `'ended' !== 'blocked'`; `ReviewCommandUseCase.run` publishes `ended` in `finally` regardless of outcome | RED (expected) |
| SC1 — unbounded current-work history reread per refresh | `test/task-2373-repro.test.ts`, `"TASK-2373 defect 5: board current-work reads do not grow with historical current-work rows"` — fails: 2 rounds parse 6 rows, 400 rounds parse 1200 rows via `findByType` | RED (expected) |
| SC1 — `q` does not terminate a real interactive board | `test/task-2373-shutdown.test.ts`, `"TASK-2373 defect 6: q terminates a real px board while a confirmation dialog is armed"` — real PTY, spawned pid 171855, `waitForExit` times out after 5000 ms and `processGone()` is false; the armed-confirmation branch in `src/interfaces/tui/shell.tsx` swallows `q` | RED (expected) |
| Ctrl+C regression companion (already green, kept as a guard) | `test/task-2373-shutdown.test.ts`, `"TASK-2373 defect 6: Ctrl+C terminates a real px board while a confirmation dialog is armed"` | PASS |
| Red tests compile under the project's test typecheck | `npx tsc --noEmit --project tsconfig.test.json` — no output | PASS |
| Existing PTY coverage unaffected by the harness extension | `npx tsx --test test/tui-pty-smoke.test.ts` — 2/2 pass | PASS |
| Baseline suite green before the fixes | `npm test` — tests 2256, pass 2256, fail 0 | PASS |

Reproduce the red set with:
`npx tsx --test test/task-2373-repro.test.ts` (6 tests, 6 fail) and
`npm run build && npx tsx --test test/task-2373-shutdown.test.ts` (1 of 2 fail).

Next action: CP-2 — thread one shared current-work publication seam from
`ReviewCommandUseCase` through `HandoffReviewPort` into the review loop, and make
`onAgentChanged`/`onAgentLaunched` awaited and ordered, turning defects 1 and 2 green
(SC2–SC7).

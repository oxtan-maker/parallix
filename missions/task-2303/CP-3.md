# CP-3: Single write-point integration

## Summary of work done

Integrated the `BoardEventRecorder` into the single `transitionTaskOnIntegrationBranch`
authority path in `src/platform/runtime/lib/tools/backlog.ts`. Every committed
transition now emits exactly one lane-transition event. Added the guardrail test
(SC2, SC3) verifying no other module calls the recorder.

- **`src/platform/runtime/lib/tools/backlog.ts`** — added fire-and-forget lane
  transition recording after `transitionTaskLocal` succeeds. Captures the old
  status before the transition overwrites the Markdown file, then dynamically
  imports the recorder stack (database adapter → migration runner → repository
  → recorder) and emits the event via `recordLaneTransitionSafely()`. Uses
  `Promise.resolve(...).catch(() => {})` so the synchronous `transitionTask`
  return is never delayed by async recording.
- **`test/board-event-guardrail.test.ts`** — source-tree guardrail test (SC2)
  scanning all `.ts` files under `src/` to verify only `backlog.ts` imports the
  recorder module outside the recorder package. SC3 test confirms
  `transitionTaskOnIntegrationBranch` contains the `recordLaneTransitionSafely`
  call and that no other function in `backlog.ts` calls it. Additional test
  verifies no source file writes lane-transition events directly outside
  `backlog.ts`.
- **`test/sqlite-adapter-cp1.test.ts`** — fixed `getCurrentVersion` test to
  expect `0003-board-lane-events` as the highest migration ID (was
  `0002-import-history` before the new migration was added).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2: guardrail test fails if any source file outside the write-path writes lane-transition events | `test/board-event-guardrail.test.ts:1` — `"SC2: only the designated write-path module imports BoardEventRecorder outside the recorder package"` and `"SC2: no source file writes lane-transition events outside backlog.ts"` | PASS |
| SC3: recorder called from exactly one location in `transitionTaskOnIntegrationBranch` | `src/platform/runtime/lib/tools/backlog.ts:695` — `recordLaneTransitionSafely` call inside `transitionTaskOnIntegrationBranch`; test `"SC3: transitionTaskOnIntegrationBranch contains the recorder call and is the single call site"` in `test/board-event-guardrail.test.ts` | PASS |
| SC3: no other function in the codebase calls the recorder | test `"SC3: no other function in backlog.ts calls the recorder"` in `test/board-event-guardrail.test.ts` | PASS |
| SC4: recording failure never blocks the authoritative transition | `src/platform/runtime/lib/tools/backlog.ts:702` — `Promise.resolve(...).catch(() => {})` fire-and-forget pattern; `src/application/recording/board-event-recorder.ts:57` — `recordLaneTransitionSafely` catches all exceptions | PASS |
| Restricted Area: `backlog.ts` modified only to add the event-recording call | Changes confined to `transitionTaskOnIntegrationBranch`; function signature and surrounding logic unchanged | PASS |
| Restricted Area: `mission-workflow.ts` not modified | No changes to `src/domain/mission-workflow.ts` | PASS |
| CP-3 tests pass | `node --import tsx --test test/board-event-guardrail.test.ts` → 4 pass / 0 fail | PASS |

## Next action

CP-4: write the metrics fixture test (SC6) recording transitions and asserting
populated metric values, add the previous-schema upgrade test (SC10), and run
final verification gates.

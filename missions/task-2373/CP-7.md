# CP-7 — Deterministic board shutdown (SC19–SC27)

## Summary of work done

Quit handling now runs before confirmation-modal input, so `q` and Ctrl+C are
process-wide exits rather than modal-only commands. The real PTY harness runs
the board command as its foreground process, records that spawned PID in
`session.pid`, and proves it is gone using `session.processGone()`.

The live-board subscription is owned by `BoardShell`'s effect cleanup: unmount
calls its unsubscribe, which clears the unref’d refresh timer. No `process.exit`
was added. The resource that previously kept the test process around was the
PTY harness’s losing `Promise.race` timeout; it now clears that timer in
`finally`. Board-dispatched operations are deliberately detached from the
client: this board only opens a confirmation and invokes the existing typed
application controller; it neither owns nor spawns child processes itself.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC19 — idle `q` kills the spawned board PID within 5s | `test/task-2373-shutdown.test.ts`, `"SC19: q terminates a real idle px board and leaves its spawned PID gone"`; `assertTerminates` records `session.pid` and calls `session.processGone()` | PASS |
| SC20 — idle Ctrl+C kills the spawned board PID within 5s | `test/task-2373-shutdown.test.ts`, `"SC20: Ctrl+C terminates a real idle px board and leaves its spawned PID gone"`; `assertTerminates` records `session.pid` and calls `session.processGone()` | PASS |
| SC21 — modal `q` and Ctrl+C terminate | `test/task-2373-shutdown.test.ts`, `"TASK-2373 defect 6: q terminates a real px board while a confirmation dialog is armed"` and `"TASK-2373 defect 6: Ctrl+C terminates a real px board while a confirmation dialog is armed"` | PASS |
| SC22 — SIGTERM terminates the spawned PID | `test/task-2373-shutdown.test.ts`, `"SC22: SIGTERM terminates the real interactive board cleanly"`; `assertTerminatesBySignal` records `session.pid` and calls `session.processGone()` | PASS |
| SC23 — subscription/timer ownership is released | `src/interfaces/tui/shell.tsx` — `subscribeProjection` effect cleanup; `src/application/projections/board-subscription.ts` — unsubscribe clears its timer | PASS |
| SC24 — in-flight ownership is explicit | `src/interfaces/tui/shell.tsx` — `confirmAction`; board dispatch is deliberately detached to the existing application controller and owns no child process | PASS |
| SC25 — raw terminal state is restored | `test/task-2373-shutdown.test.ts`, `assertTerminates` and `assertTerminatesBySignal` assert `session.terminalRestored()` | PASS |
| SC26 — repeated real start/quit leaves all spawned PIDs gone | `test/task-2373-shutdown.test.ts`, `"SC26: ten real start-and-quit cycles leave every spawned board PID gone"` | PASS |
| SC27 — identified retained resource is fixed without `process.exit()` | `test/helpers/pty-smoke-harness.ts` — `timeout()` clears its losing timeout; `test/task-2373-shutdown.test.ts` | PASS |
| Real PTY suite | `npm run build && npx tsx --test test/task-2373-shutdown.test.ts` — 6/6 pass | PASS |

Next action: CP-8 — replace the unbounded `mission.current-work` history read with an
indexed latest-facts query and prevent unnecessary board refresh rebuild work.

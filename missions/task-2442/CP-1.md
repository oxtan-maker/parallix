# CP 1 — Repro test locks the bug (red at parent)

## Summary of work done

- Authored `test/task-2442-repro.test.ts` before any fix, per the mission contract.
- The file drives the existing `subscribeToBoardProjection` seam with the injected `setTimer`/`clearTimer` fake scheduler and deterministic projections. Consecutive raw `blockedForMs` values differ by exactly one poll (262,800,000 ms → 262,798,000 ms); both render the same `AgentStrip` countdown label `3d` (`formatCountdown` day branch).
- Three tests:
  - `SC1: a same-label blocked countdown emits one notification and no second mounted Ink frame` — mounts the real `BoardShell` through Ink's `render` with a controlled output stream (`debug: true` so every render commit writes an observable frame), wires the real subscription through `subscribeProjection`, fires two fake ticks, and asserts exactly one subscription notification, one repainted content frame, and that the repainted frame still shows `3d` and the displayed block reason.
  - `SC1: a raw blockedForMs change that renders the same countdown does not re-publish` — helper-level subscription variant of the same scenario.
  - `SC2: every scheduled tick invokes the projection builder even when the fingerprint is unchanged` — five fake ticks, asserts the projection builder runs five times.
- No real-time sleep, retry loop, forced GC, heap-size setting, or memory threshold: waits are event-loop turns (`setImmediate`) and an event-driven frame wait whose timer only converts a silent miss into a loud failure.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Repro test exists and drives the subscription with an injected timer + deterministic projections differing by one poll | `test/task-2442-repro.test.ts`, `SC1: a raw blockedForMs change that renders the same countdown does not re-publish` | PASS |
| Repro is RED at the parent commit (second notification/frame observed) | `npm test -- test/task-2442-repro.test.ts` at this commit fails all 3 tests; observed assertion `SC1: an invisible raw-duration change must not publish a second notification … 2 !== 1` (reproducible at this commit, before the fix commit lands) | RED (expected) |
| Mounted Ink regression goes through the real subscription-to-render path, not a helper-level assertion | `test/task-2442-repro.test.ts`, `SC1: a same-label blocked countdown emits one notification and no second mounted Ink frame` (mounted `BoardShell` via Ink `render` + controlled `stdout`) | PASS |
| Projection build retained on every scheduled tick (SC2 locked) | `test/task-2442-repro.test.ts`, `SC2: every scheduled tick invokes the projection builder even when the fingerprint is unchanged` | PASS (assertion present; test red at parent only via the notification count) |
| Determinism constraint (SC5): no sleep/retry/GC/heap knobs in the repro | `test/task-2442-repro.test.ts` — fake `setTimer`/`clearTimer` seam, `setImmediate` turns, event-driven `waitForFrame` failure guard only | PASS |

Next action: CP-2 — implement the display-aligned normalization at the refresh seam: extract the pure `formatCountdown` from `src/interfaces/tui/agent-strip.tsx` into a shared application-layer module and make `boardFingerprint` in `src/application/projections/board-subscription.ts` compare the rendered countdown text instead of raw `blockedForMs`, keeping every non-countdown fingerprint field; then re-run `npm test -- test/task-2442-repro.test.ts` and confirm all three tests flip green.

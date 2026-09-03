# CP-5: High-volume SSE/progress/reconnect — bounded buffer/listener/timer

## Summary

High-volume synthetic SSE/progress/reconnect tests assert bounded server/client
buffers, listener count, and timer count with no real-time soak/sleep and no
`sleep` to delay assertions. Progress is driven in tight loops; timers use a
deterministic manual-timer seam (`manualTimers()` in `test/web-host.integration.test.ts`)
so no wall-clock `setTimeout`/`setInterval` soak exists to hide a leak.

- `test/web-stream.test.ts` "the replay buffer stops at the exported bound and
  evicts oldest first": pushes `WEB_EVENT_BUFFER_LIMIT + 50` events, asserts
  `bufferedCount() === WEB_EVENT_BUFFER_LIMIT` and the oldest 50 were evicted.
- `test/web-stream.test.ts` "high-volume progress keeps the buffer and listener
  count constant": publishes well past the bound, asserts `bufferedCount() <=
  WEB_EVENT_BUFFER_LIMIT` and `listenerCount() === 1` throughout, then
  `listenerCount() === 0` after unsubscribe (no listener leak).
- `test/web-host.integration.test.ts` "1000 synthetic progress events keep one
  listener and a bounded buffer": 1000 real-socket progress frames through the
  production host assert one listener and a bounded replay buffer.
- Reconnect uses the manual timer seam, not a real timer: `test/web-host.integration.test.ts`
  "SSE reconnect with Last-Event-ID replays only newer events" and
  "a failed rebuild emits a typed stream error and the next tick still invalidates"
  advance `timers.tick()` deterministically.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Bounded replay buffer at `WEB_EVENT_BUFFER_LIMIT` | `test/web-stream.test.ts` "the replay buffer stops at the exported bound and evicts oldest first" | PASS |
| Listener count bounded (no leak) | `test/web-stream.test.ts` "high-volume progress keeps the buffer and listener count constant" | PASS |
| 1000 real-socket events bounded | `test/web-host.integration.test.ts` "1000 synthetic progress events keep one listener and a bounded buffer" | PASS |
| No soak/sleep; deterministic timer seam | `test/web-host.integration.test.ts` manual `timers.tick()` reconnect tests | PASS |

## Next action: commit CP-5, then CP-6 packaging proof (npm pack + browser bundle audit).

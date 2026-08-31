# CP-4: Bounded reconnect-safe operation log and gate

## Summary

The browser opens `/api/events` only after its validated snapshot is ready.
`web/src/shell.tsx` validates every `progress` event, deduplicates by the
server-owned `(operationId, sequence)` pair, and keeps the newest 256 rows.
It stores neither events nor snapshots persistently. The server’s existing
bounded replay buffer is also 256 entries (`WEB_EVENT_BUFFER_LIMIT`), and
reconnect replay uses its SSE cursor.

`./scripts/verify-local.sh all` passed after the final changes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Cards animate only for live work; other activity states remain textual and stationary | `test/web-board-render.test.ts` — "activity, coordinator recovery evidence, and reduced motion stay truthful" | PASS |
| Coordinator evidence does not assert a running agent | `web/src/format.ts`; `test/web-board-render.test.ts` — "activity, coordinator recovery evidence, and reduced motion stay truthful" | PASS |
| Family strip preserves availability, countdown, command liveness, unknown, zero, and unattributed evidence | `web/src/top-bar.tsx`; `test/web-board-render.test.ts` — "omitted, null and observed-zero running sessions each render as themselves" | PASS |
| Attention preserves projected rank, reason, and action | `web/src/attention-rail.tsx`; `test/web-transport.test.ts` — "attention action keeps the server-owned display text and state" | PASS |
| FLOW metrics fail closed and render projected health, unavailable history, and populated values | `test/web-transport.test.ts` — "snapshot metrics are projected and malformed metrics fail closed"; `test/web-board-render.test.ts` — "FLOW renders every projected metric health state without fabricated history", "FLOW renders populated projected values with their observation counts" | PASS |
| Review detail uses projected round, phase, disposition, and blocking fields | `web/src/flight-column.tsx`; `test/web-board-render.test.ts` — "card facts render from the server without substitution" | PASS |
| Operation log is bounded and reconnect-safe | `test/web-board-render.test.ts` — "operation progress deduplicates reconnects and evicts oldest entries"; `src/interfaces/web/stream.ts` | PASS |
| Reduced motion retains sufficient activity text | `web/src/style.css`; `test/web-board-render.test.ts` — "activity, coordinator recovery evidence, and reduced motion stay truthful" | PASS |
| Mission verification gate passes | `./scripts/verify-local.sh all` | PASS |

Next action: Handoff task-2435 with CP-1 through CP-4 committed.

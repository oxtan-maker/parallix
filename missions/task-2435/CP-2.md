# CP-2: Truthful activity and attention rendering

## Summary

Updated the GPU/fan board treatment to make every activity state textual and
authoritative. `web/src/format.ts` permits fans only for
`activity.work.kind === 'working'` with `certainty === 'live'`; unconfirmed,
stale, blocked, and idle work remain visible but stationary. Each card now
prints `activity.coordinator` as explicitly labelled recovery evidence, so a
live coordinator cannot assert running work.

The family strip continues to render projected availability, finite or
indefinite countdowns, optional command-session liveness (including unknown
and zero), and unattributed session evidence. `web/src/attention-rail.tsx`
continues to map the received queue without sorting or command selection.
`web/src/style.css` disables decorative fan motion for reduced-motion users;
the card’s text still names the activity state.

`test/web-board-render.test.ts` now includes "activity, coordinator recovery
evidence, and reduced motion stay truthful" to exercise all five work states,
the live-coordinator-with-stale-work combination, the two live fans only, and
the reduced-motion rule.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Cards animate only for live work and label unconfirmed, stale, blocked, and idle states | `test/web-board-render.test.ts` — "activity, coordinator recovery evidence, and reduced motion stay truthful" | PASS |
| Coordinator/session evidence cannot create a running fan without live current work | `web/src/format.ts`; `test/web-board-render.test.ts` — "activity, coordinator recovery evidence, and reduced motion stay truthful" | PASS |
| Family strip preserves availability, block countdown, command liveness, unknown, zero, and unattributed evidence | `web/src/top-bar.tsx`; `web/src/format.ts`; `test/web-board-render.test.ts` — "omitted, null and observed-zero running sessions each render as themselves" | PASS |
| Attention retains projected order, reason, and action | `web/src/attention-rail.tsx`; `test/web-transport.test.ts` — "attention action keeps the server-owned display text and state" | PASS |
| FLOW values are still pending their direct transport projection | `src/application/projections/board.ts`; `src/interfaces/web/transport.ts` | Pending CP-3 |
| Review fields render from dedicated projection fields | `web/src/flight-column.tsx`; `test/web-board-render.test.ts` — "card facts render from the server without substitution" | PASS |
| Operation log reconnect behavior is pending SSE client work | `src/interfaces/web/stream.ts`; `test/web-host.integration.test.ts` | Pending CP-4 |
| Reduced motion removes decoration while retaining textual activity | `web/src/style.css`; `test/web-board-render.test.ts` — "activity, coordinator recovery evidence, and reduced motion stay truthful" | PASS |
| Activity/coordinator coverage runs before the final mission gate | `npx tsx --test test/web-board-render.test.ts` | PASS |

Next action: Project `BoardProjection.metrics` through the versioned web transport and render health, provenance, sample size, FLOW, throughput, and bottleneck facts without adding fallback points or summaries.

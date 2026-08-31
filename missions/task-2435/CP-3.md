# CP-3: Projected FLOW and review detail

## Summary

`src/interfaces/web/transport.ts` now carries a JSON-safe, read-only subset of
the existing `BoardProjection.metrics`: health, provenance sample size and
newest event, cumulative FLOW, lane cycle-time figures, weekly throughput, and
the projected bottleneck sentence. `web/src/flow-panel.tsx` only prints those
received values and each series' supplied missing-history fallback; it creates
no points, median, weekly total, or narrative.

Review rendering remains on `reviewRound`, `reviewPhase`,
`reviewDisposition`, and `blockingReason` from the card DTO, rather than flags
or display text.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Live-only activity and separate coordinator evidence remain rendered | `test/web-board-render.test.ts` — "activity, coordinator recovery evidence, and reduced motion stay truthful" | PASS |
| Family and attention facts remain projection-owned | `web/src/top-bar.tsx`; `web/src/attention-rail.tsx`; `test/web-transport.test.ts` — "attention action keeps the server-owned display text and state" | PASS |
| FLOW, cycle, throughput, bottleneck, provenance, sample size, and health are direct transport fields | `src/interfaces/web/transport.ts`; `web/src/flow-panel.tsx` | PASS |
| Missing history renders its projected fallback with no fabricated points | `web/src/flow-panel.tsx`; `test/fixtures/board-projection.ts` | PASS |
| Review uses dedicated projected fields rather than flags | `web/src/flight-column.tsx`; `test/web-board-render.test.ts` — "card facts render from the server without substitution" | PASS |
| Reconnect-safe operation log remains for CP-4 | `src/interfaces/web/stream.ts`; `test/web-host.integration.test.ts` | Pending CP-4 |
| Reduced motion remains textual | `web/src/style.css`; `test/web-board-render.test.ts` | PASS |
| Transport and browser checks pass | `npx tsx --test test/web-transport.test.ts test/web-board-render.test.ts` | PASS |

Next action: Subscribe the browser operation log to validated SSE progress, retain the last 256 entries, deduplicate by `operationId` plus `sequence`, then run the mission gate.

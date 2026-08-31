# CP-1: Authoritative board-read trace

## Summary

Traced the web board from the versioned transport contract into each visible
read-side surface. `src/interfaces/web/transport.ts` is the browser boundary;
the client must render its fields directly rather than recover them from lanes,
processes, or display text.

| Visual claim | Authoritative field | Consumer and extension test |
|---|---|---|
| Card activity and motion | `card.activity.work` (`working` with `live`/`unknown`/`stale`, `blocked`, or `idle`) | `web/src/format.ts`, `web/src/flight-column.tsx`; `test/web-transport.test.ts` — "mission work activity preserves live, unconfirmed, stale, blocked, and idle liveness" |
| Coordinator recovery evidence | `card.activity.coordinator` (`unknown`, `stopped`, or `live`) | No browser rendering exists yet; `test/web-transport.test.ts` — "coordinator evidence distinguishes unknown, stopped, and live" |
| Family availability and process observation | `snapshot.agentAvailability` plus optional `snapshot.unattributedRunningSessions` | `web/src/top-bar.tsx`, `web/src/format.ts`; `test/web-transport.test.ts` — "running sessions distinguish unobserved, observed-none, and a positive count" |
| Attention order, reason, and action | `snapshot.attentionQueue` in received order; `item.reason`, `item.action` | `web/src/attention-rail.tsx`; `test/web-transport.test.ts` — "attention action keeps the server-owned display text and state" |
| FLOW, cycle, throughput, bottleneck, provenance, sample size, and health | `snapshot.metrics` | No browser rendering exists yet; `src/interfaces/web/transport.ts` and `test/web-transport.test.ts` are the contract extension points |
| Review round, phase, disposition, and blocking | `card.reviewRound`, `card.reviewPhase`, `card.reviewDisposition`, `card.blockingReason` | `web/src/flight-column.tsx`; `test/web-board-render.test.ts` — "card facts render from the server without substitution" |
| Operation progress and reconnect identity | SSE `progress` events from `/api/events`, with `operationId` and `sequence` | `src/interfaces/web/host.ts`, `src/interfaces/web/stream.ts`; `test/web-host.integration.test.ts` and `test/web-transport.test.ts` |

The current browser is snapshot-only (`web/src/board-data.ts`) and deliberately
has no `EventSource`; CP-4 will add the smallest reconnect-safe subscriber.
The current fan predicate in `web/src/format.ts` is already correctly limited
to authoritative live work. The missing UI work is to expose certainty and
recovery evidence without turning coordinator/session/process observations
into a running-agent claim.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Activity has one authoritative source for live, unconfirmed, stale, blocked, and idle rendering | `src/interfaces/web/transport.ts`; `test/web-transport.test.ts` — "mission work activity preserves live, unconfirmed, stale, blocked, and idle liveness" | Traced |
| Coordinator evidence remains separate from authoritative current work | `test/web-transport.test.ts` — "coordinator evidence distinguishes unknown, stopped, and live"; `web/src/format.ts` | Traced |
| Family availability preserves availability, blocks, countdowns, process liveness, unknown/zero, and unattributed evidence | `web/src/top-bar.tsx`; `web/src/format.ts`; `test/web-transport.test.ts` — "running sessions distinguish unobserved, observed-none, and a positive count" | Traced |
| Attention preserves projected ordering, reason, and action | `web/src/attention-rail.tsx`; `test/web-transport.test.ts` — "attention action keeps the server-owned display text and state" | Traced |
| Metrics and review use projected fields rather than fabricated or reparsed values | `src/interfaces/web/transport.ts`; `web/src/flight-column.tsx`; `test/web-board-render.test.ts` — "card facts render from the server without substitution" | Traced |
| Operation progress has a server-owned SSE route and stable reconnect identity | `src/interfaces/web/host.ts`; `src/interfaces/web/stream.ts`; `test/web-host.integration.test.ts` | Traced |
| Reduced motion retains textual state | `web/src/style.css`; `web/src/format.ts` | Traced |
| Mission gate and full combination coverage will be run at CP-4 | `./scripts/verify-local.sh all`; `test/web-board-render.test.ts`; `test/web-transport.test.ts` | Pending implementation |

Next action: Implement CP-2 in `web/src/flight-column.tsx` and `web/src/top-bar.tsx`, adding explicit work certainty and separately labelled coordinator recovery evidence while preserving the existing GPU/fan treatment.

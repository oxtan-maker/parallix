# CP-1: Map the seams and record the decision

No production behaviour changed in this checkpoint. This document records the
seam map, route paths, event names, buffer bound, and timer seams that CP-2
through CP-5 implement, so the later checkpoints are wiring rather than design.

## Seam map (read from the committed tree)

**Projection port.** `composeBoardProjection` (`src/composition/board-projection.ts`)
is the sole production constructor for board reads. `subscribeToBoardProjection`
(`src/application/projections/board-subscription.ts`) already takes exactly the
shape the web host needs: `build: () => Promise<BoardProjection>` plus
`BoardSubscriptionOptions` carrying `setTimer` / `clearTimer` / `onError`. The
host therefore takes an injected `buildProjection: () => Promise<BoardProjection>`
port in `WebHostOptions` and never imports a concrete read adapter — the same
inversion ADR 0051 requires of every presentation surface.

**Progress port.** `BoardProgressSink` (`src/application/controller/board-command.ts`)
is `(event: ProgressEvent) => void`, and `OperationEvent` already carries
`operationId` and `sequence`. Rather than inventing a second identity scheme or
a second event bus, the host *is* a sink: `WebHost` exposes a `progress:
BoardProgressSink` member that composition hands to
`commandControllerFactory`. `toWebProgressEvent`
(`src/interfaces/web/transport.ts`) converts it unchanged.

**Change detection.** Only `subscribeToBoardProjection`. It fires solely when
`boardFingerprint` changes, which is why the invalidation event carries no board
payload and why no test may assert one invalidation per progress event.

## Decisions

| Decision | Value | Rationale |
|---|---|---|
| Snapshot route | `GET /api/board` | Specific route outranks the existing `/*` asset catch-all in Fastify's radix router; no change to `resolveAssetPath`. |
| SSE route | `GET /api/events` | Same host, same `onRequest` boundary (exact-`Host`, loopback bind) from ADR 0054. |
| SSE event names | `progress`, `invalidate`, `error` | `invalidate` carries `{"kind":"projection-invalidated"}` only — "refetch the snapshot", never a board payload (ADR 0055 keeps the board shape in the snapshot envelope). |
| Snapshot build failure | HTTP 503 with `{ kind: 'board-snapshot-error', transportVersion, error: WebCommandError }` | Reuses `WebErrorKind` / `WebCommandError` types imported from `transport.ts`; adds no new envelope *to* `transport.ts`, honouring the restricted area. |
| Event id counter | one per host process, monotonic integer, shared by `progress`, `invalidate`, and `error` | Success criterion: ids strictly increase across both event types. |
| Replay buffer bound | `WEB_EVENT_BUFFER_LIMIT`, exported from the new `src/interfaces/web/stream.ts` | Tests assert against the exported constant, not a literal; eviction is oldest-first via `shift()`, never `array = [...array, event]`. |
| Reconnect | `Last-Event-ID` request header; replay only buffered entries with id strictly `> n` | Truth is always re-established by refetching `/api/board`; SSE is notification state only. |
| Timer seam | `WebHostOptions.subscription?: BoardSubscriptionOptions` passed straight to `subscribeToBoardProjection` | The seam already exists; no new clock abstraction is introduced. No new test calls a real sleep. |
| New module | `src/interfaces/web/stream.ts` (counter + bounded buffer + client registry) | Keeps the 1000-event and eviction tests hermetic (no sockets), and keeps `host.ts` focused on routing and policy. |

SSE frames are written through `reply.hijack()` + `reply.raw`, with
`PROTECTION_HEADERS`, `content-type: text/event-stream`, `cache-control:
no-store`, and `connection: keep-alive` written explicitly on the raw response —
the `onSend` hook does not run for a hijacked reply, so the headers are asserted
directly rather than assumed to be inherited. The existing CSP already contains
`connect-src 'self'`, which permits a same-origin `EventSource`; it is not
widened.

## Test plan (files created in CP-2..CP-4)

| Concern | Test file |
|---|---|
| Buffer bound, eviction, id monotonicity, `Last-Event-ID` filtering, listener counts | `test/web-stream.test.ts` (hermetic, no sockets) |
| Snapshot route, SSE route, unauthenticated 200, wrong-`Host` 403, build failure, disconnect/close cleanup | `test/web-host.integration.test.ts` (extends the existing real-loopback suite) |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Snapshot built from the production `BoardProjectionBuilder` via an injected port, never a read adapter constructed in the web layer | `composeBoardProjection` in `src/composition/board-projection.ts` supplies `build()`; `subscribeToBoardProjection` in `src/application/projections/board-subscription.ts` already accepts that exact closure shape; ADR 0051 | PASS (seam confirmed) |
| Board change detection reaches the host only through `subscribeToBoardProjection` | `src/application/projections/board-subscription.ts` exports `subscribeToBoardProjection` and `BOARD_REFRESH_INTERVAL_MS`; no other seam is used | PASS (decision recorded) |
| Progress reuses the command boundary's `operationId` / `sequence` | `OperationEvent` and `BoardProgressSink` in `src/application/controller/board-command.ts`; `toWebProgressEvent` in `src/interfaces/web/transport.ts` passes both through unchanged | PASS (seam confirmed) |
| Replay buffer has an exported numeric bound | `WEB_EVENT_BUFFER_LIMIT` to be exported from `src/interfaces/web/stream.ts`, asserted by `test/web-stream.test.ts` | PENDING (CP-3) |
| `WEB_TRANSPORT_VERSION` unchanged | `grep -n "WEB_TRANSPORT_VERSION = " src/interfaces/web/transport.ts` reports `1 as const`; no edit to `src/interfaces/web/transport.ts` in this checkpoint | PASS |
| Every new test drives time through injected timer/clock seams | `BoardSubscriptionOptions.setTimer` / `clearTimer` in `src/application/projections/board-subscription.ts` is the injected seam the host forwards | PASS (decision recorded) |
| `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` pass | Gates run in CP-5 | PENDING (CP-5) |

Next action: CP-2 — add `buildProjection` to `WebHostOptions` and register `GET /api/board` in `src/interfaces/web/host.ts`, returning `toWebBoardSnapshot(...)`, plus the four snapshot tests (valid snapshot, no-cookie/no-CSRF/no-Origin 200, wrong-`Host` 403, failing build returns 503 not an empty board) in `test/web-host.integration.test.ts`.

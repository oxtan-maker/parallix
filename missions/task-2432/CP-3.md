# CP-3: SSE route with bounded replay, reconnect, and typed events

`GET /api/events` (`WEB_EVENTS_PATH`) now streams three event names —
`progress`, `invalidate`, `error` — from one per-host-process
`WebEventStream` in `src/interfaces/web/stream.ts`. Ids come from a single
monotonic counter shared by every event name and every client; the replay
buffer is bounded by the exported `WEB_EVENT_BUFFER_LIMIT` (256) with
oldest-first eviction; reconnects honour `Last-Event-ID` by replaying only
buffered frames with a strictly greater id.

## Work done

- `src/interfaces/web/stream.ts` (new): `createWebEventStream` owns the id
  counter, the in-place bounded buffer (`push`/`shift`, never
  `buffer = [...buffer, frame]`), and the listener `Set`.
  `publishProgress` converts the command-boundary `ProgressEvent` through
  `toWebProgressEvent` (operationId/sequence pass through unchanged);
  `publishInvalidation` carries only
  `{ kind: 'projection-invalidated', transportVersion }` — no board payload;
  `publishError` carries a `stream-error` envelope wrapping a
  `WebCommandError`. `formatSseFrame` writes `id:`, `event:`, `data:`.
- `src/interfaces/web/host.ts`: the SSE route hijacks the reply and writes
  `PROTECTION_HEADERS` plus `content-type: text/event-stream`,
  `cache-control: no-store`, `x-accel-buffering: no` explicitly (the `onSend`
  hook never runs for a hijacked reply), replays `Last-Event-ID`, then
  subscribes one listener per client. Each client is one `detach` entry in a
  `Set` that drops its listener and ends its stream; `request.raw`
  `close`/`error` both route to it. `host.progress` is now a
  `BoardProgressSink` that composition will hand to the command controller;
  `host.clientCount()` exposes the live client count.
- The shared `subscribeToBoardProjection` seam is started inside
  `start()` when `buildProjection` is present: one subscription per host,
  fired only on fingerprint change, publishing `invalidate`. Its `onError`
  publishes a typed `error` frame and forwards to the caller's `onError` —
  the loop keeps ticking, so the next rebuild recovers. The timer seam is
  `WebHostOptions.subscription` (`BoardSubscriptionOptions`), passed through
  unchanged; tests drive it with a manual timer, no real clock.

## Verification

- `npm test -- test/web-stream.test.ts` — 9 pass, 0 fail (hermetic: no
  sockets, no timers).
- `npm test -- test/web-host.integration.test.ts` — 26 pass, 0 fail
  (real loopback sockets; the SSE tests wait for frames event-driven, no
  sleep).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SSE frames carry strictly increasing `id:` values across both `progress` and invalidation events from one shared counter | `"web stream: one counter issues strictly increasing ids across every event name"` in `test/web-stream.test.ts`; `"web host: SSE ids strictly increase across progress and invalidation events"` in `test/web-host.integration.test.ts` (ids `[1,2,3,4]` over progress/invalidate pairs) | PASS |
| A reconnect with `Last-Event-ID: <n>` receives only events with id `> n`; zero repeated `operationId`+`sequence` pairs | `"web stream: reconnect with Last-Event-ID replays only newer events"` in `test/web-stream.test.ts`; `"web host: SSE reconnect with Last-Event-ID replays only newer events"` in `test/web-host.integration.test.ts` (missed seq 3–4 replayed, no duplicate pair) | PASS |
| Emitted progress events reuse the command boundary's `operationId`/`sequence` unchanged and each payload is `validateWebProgressEvent`-accepted | `"web stream: progress frames carry the command boundary operationId and sequence unchanged"` in `test/web-stream.test.ts`; `"web host: SSE stream sends streaming and protection headers and frames before the response ends"` asserts `validateWebProgressEvent(frame.data).ok` in `test/web-host.integration.test.ts` | PASS |
| The invalidation carries no board payload, only a refetch signal | `"web stream: an invalidation carries no board payload, only a refetch signal"` in `test/web-stream.test.ts`; the socket test asserts `data` deep-equals `{ kind: 'projection-invalidated', transportVersion: 1 }` | PASS |
| A transient projection-build failure emits a typed error event, never an empty board; the subscription survives and the next tick invalidates | `"web host: a failed rebuild emits a typed stream error and the next tick still invalidates"` in `test/web-host.integration.test.ts` — first tick throws → `error` frame with `unavailable` error, timer still scheduled; second tick → `invalidate` | PASS |
| The replay buffer has an exported numeric bound; bound+50 pushes leave exactly `bound` retained, oldest evicted first | `WEB_EVENT_BUFFER_LIMIT` exported from `src/interfaces/web/stream.ts`; `"web stream: the replay buffer stops at the exported bound and evicts oldest first"` in `test/web-stream.test.ts` | PASS |
| No new test calls a real `setTimeout`-based sleep; time is driven through injected seams | `manualTimers()` helper in `test/web-host.integration.test.ts` drives `BoardSubscriptionOptions.setTimer`/`clearTimer`; `test/web-stream.test.ts` uses no timers at all | PASS |
| SSE response headers are explicit (streaming + protection) and frames arrive before the response ends | `"web host: SSE stream sends streaming and protection headers and frames before the response ends"` in `test/web-host.integration.test.ts` — asserts `text/event-stream`, `no-store`, full CSP with `connect-src 'self'`, no `content-length`, first frame received while the socket is still open | PASS |
| Unauthenticated 200 / wrong-`Host` 403 apply to the SSE route too | `"web host: SSE route answers without cookie, CSRF header, or Origin but rejects a wrong Host"` in `test/web-host.integration.test.ts` | PASS |
| `WEB_TRANSPORT_VERSION` and ADR 0055 envelope shapes unchanged | `git diff f62739c24..HEAD --stat -- src/interfaces/web/transport.ts` reports no change; `src/interfaces/web/stream.ts` imports the types, adds none to `transport.ts` | PASS |
| `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` pass | Gates run in CP-5 | PENDING (CP-5) |

Next action: CP-4 — add `waitForStop`/`createBoardSource` seams to `runWebCommand` in `src/interfaces/cli/web.ts`, wire `createProductionApplicationServices(rootDir, host.progress)` into the `web` entry of `src/composition/create-cli.ts` so `px web` serves live board data, and add a hermetic seam test to `test/web-host.integration.test.ts`.

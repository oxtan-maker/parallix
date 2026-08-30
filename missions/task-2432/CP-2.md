# CP-2: Read-only board snapshot route

`createWebHost` now accepts an injected `buildProjection: () => Promise<BoardProjection>`
port and serves `GET /api/board` (exported as `WEB_SNAPSHOT_PATH`), returning
`toWebBoardSnapshot(...)` from `src/interfaces/web/transport.ts`. The web layer
constructs no read adapter of its own — the closure comes from composition
(ADR 0051).

## Work done

- `WebHostOptions.buildProjection` added to `src/interfaces/web/host.ts`; the
  interfaces layer imports only the `BoardProjection` *type*, no adapter.
- `WEB_SNAPSHOT_PATH` (`/api/board`) registered as a specific Fastify route, so
  it outranks the existing `/*` asset catch-all without touching
  `resolveAssetPath` or the security module.
- `WebBoardSnapshotError` (`kind: 'board-snapshot-error'`) added to `host.ts`,
  reusing the `WebCommandError` and `WebTransportVersion` types imported from
  `transport.ts`. `transport.ts` itself is unedited, so `WEB_TRANSPORT_VERSION`
  and the ADR 0055 envelopes are untouched.
- Failure taxonomy: a rejected build is `503` + `error.kind: 'unavailable'`
  (transient, retry); a projection the transport refuses to project is `500` +
  `error.kind: 'execution'` (contract failure). Neither path can return an
  empty board, because the empty-board value is never constructed.
- The route is registered under the existing `onRequest` hook, so the
  exact-`Host` 403 and the loopback bind apply to it unchanged, and no cookie,
  CSRF header, or `Origin` is consulted for a read-only method.

## Verification

`npm test -- test/web-host.integration.test.ts` — 19 pass, 0 fail.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `GET` snapshot route returns 200 with a body `validateWebBoardSnapshot` accepts, carrying `kind: 'board-snapshot'`, `transportVersion` = `WEB_TRANSPORT_VERSION`, and `projectionVersion` from the `BoardProjection` | `"web host: snapshot route returns a valid versioned board snapshot"` in `test/web-host.integration.test.ts` | PASS |
| Snapshot route returns 200 for a request with no cookie, no `x-px-csrf`, and no `Origin` | `"web host: snapshot route answers 200 without cookie, CSRF header, or Origin"` in `test/web-host.integration.test.ts` (also asserts `PROTECTION_HEADERS['content-security-policy']` still applies) | PASS |
| A wrong-`Host` request is rejected with 403 | `"web host: snapshot route rejects a Host header that is not the bound loopback origin"` in `test/web-host.integration.test.ts` — forged Host and wrong port both 403, correct Host 200 | PASS |
| A transient projection-build failure is surfaced as a typed error, never a 200 empty board, and the next read recovers | `"web host: a failing projection build surfaces an error, never an empty board"` in `test/web-host.integration.test.ts` — first build throws → 503 `board-snapshot-error` / `unavailable`, second build → 200 with 3 active cards | PASS |
| Snapshot is built from the production board projection via an injected port; no read adapter is constructed in web code | `WebHostOptions.buildProjection` in `src/interfaces/web/host.ts`; ADR 0051; composition wiring lands in CP-4 | PASS (port), PENDING (`px web` wiring, CP-4) |
| `WEB_TRANSPORT_VERSION` and the ADR 0055 envelope shapes unchanged | `git diff HEAD~1 --stat -- src/interfaces/web/transport.ts` reports no change; the error envelope lives in `host.ts` and only *imports* `WebCommandError` | PASS |
| SSE route, id monotonicity, `Last-Event-ID` replay, bounded buffer | `test/web-stream.test.ts` (CP-3) | PENDING (CP-3) |
| `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` | Gates run in CP-5 | PENDING (CP-5) |

Next action: CP-3 — add `src/interfaces/web/stream.ts` exporting `WEB_EVENT_BUFFER_LIMIT`, the per-process monotonic id counter, the oldest-first bounded replay buffer, and `Last-Event-ID` filtering; register `GET /api/events` on the host emitting `progress` / `invalidate` / `error` frames; cover it with `test/web-stream.test.ts`.

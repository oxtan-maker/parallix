# CP-4: Teardown and load behaviour proven; `px web` serves live board data

## Work done

**Teardown + load (tests, passing in the committed tree).** The SSE
teardown and load proofs from the mission's CP-4 scope live in
`test/web-host.integration.test.ts` and `test/web-stream.test.ts`:

- Per-client removal: each client is one `detach` entry in a `Set` in
  `src/interfaces/web/host.ts`; `request.raw` `close`/`error` route to it,
  dropping exactly that client's listener and ending its stream. Proven by
  `"web host: a disconnect removes that client, and close() unsubscribes
  the projection"` — `host.clientCount()` goes 2 → 1 on one disconnect, the
  disconnected client receives nothing further, and after `host.close()`
  the injected timer seam reports `clearCount` 1, `scheduled` false, and no
  new `setTimer` call.
- Load: `"web host: 1000 synthetic progress events keep one listener and a
  bounded buffer"` drives 1000 events through a real loopback socket with
  one client, asserts a constant client count, and proves a stale
  `Last-Event-ID: 0` replays exactly `WEB_EVENT_BUFFER_LIMIT` frames with
  the oldest evicted first. The hermetic twin
  `"web stream: high-volume progress keeps the buffer and listener count
  constant"` runs the same volume without a socket. No real agent process,
  no real sleep.

**`px web` wiring (new in this checkpoint).**

- `src/interfaces/cli/web.ts`: `WebCliOptions` gains `createBoardSource`
  (receives the host's `BoardProgressSink`, returns a
  `WebBoardSource` — the injected build port plus a service closer) and a
  `waitForStop` seam. `runWebCommand` resolves the source from
  `host.progress` before `start()` (the host and the source reference each
  other; the injected `buildProjection` closure reads the resolved source at
  call time, and the first build only happens after it is set), returns the
  `WebHostInfo`, and closes the source's services in a `finally` on every
  exit path.
- `src/composition/create-cli.ts`: the `web` entry now wires
  `createProductionApplicationServices(rootDir, host.progress)` — the
  production `BoardProjectionBuilder` becomes the host's build port and the
  command-boundary progress sink becomes the host's SSE sink. The command
  stays read-only: nothing here dispatches a mutation.
- New hermetic test in `test/web-host.integration.test.ts`:
  `"web cli: createBoardSource gets the host sink, its build port serves,
  close runs on stop"` — the source's build port answers
  `GET /api/board` with a `validateWebBoardSnapshot`-accepted body, a
  publish on the handed-over sink reaches a fresh SSE client through the
  replay buffer (operationId/sequence unchanged), and the source's `close`
  runs when the command exits. Logs are captured via `setLogger`; the stop
  is the injected `waitForStop` — no real signal, no real sleep.

**Live smoke (re-runnable against the committed tree).**
`node --require <repo>/node_modules/tsx/dist/preflight.cjs --import
file://<repo>/node_modules/tsx/dist/loader.mjs src/entry/px.ts web` (i.e.
`npm run dev -- web`): announces the loopback origin, `GET /api/board`
returns 200 with the real repository board (`kind: board-snapshot`,
`transportVersion: 1`, 7 backlog cards observed), `GET /api/events`
streams `id:` + `event: invalidate` frames from the shared subscription's
first tick, and SIGTERM to the serving node PID exits with code 0 and the
`[web] host stopped` line (3/3 consecutive runs clean).

## Verification

- `npm test -- test/web-host.integration.test.ts` — 27 pass, 0 fail
- `npm test -- test/web-stream.test.ts` — 9 pass, 0 fail
- `npm test -- test/web-host.integration.test.ts test/web-stream.test.ts test/web-transport.test.ts test/web-security-policy.test.ts` — 64 pass, 0 fail
- `npx tsc --noEmit` — clean

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| After a client disconnects, the host holds zero listeners and zero timers for that client; after `host.close()`, the projection subscription is unsubscribed and no timer remains scheduled | `"web host: a disconnect removes that client, and close() unsubscribes the projection"` in `test/web-host.integration.test.ts` — asserts `host.clientCount()` 2→1→0, `timers.clearCount === 1`, `timers.scheduled === false`, `timers.setCount` unchanged by close, against the injected `setTimer`/`clearTimer` counters | PASS |
| A high-volume synthetic progress test drives at least 1000 events with no real agent process and no real sleep, asserting the buffer length ceiling and a constant listener count | `"web host: 1000 synthetic progress events keep one listener and a bounded buffer"` in `test/web-host.integration.test.ts` (real socket, `clientCount()` constant, replay capped at `WEB_EVENT_BUFFER_LIMIT`); hermetic twin `"web stream: high-volume progress keeps the buffer and listener count constant"` in `test/web-stream.test.ts` | PASS |
| Every new test drives time through injected timer/clock seams; no new test calls a real `setTimeout`-based sleep | `manualTimers()` in `test/web-host.integration.test.ts`; `waitForStop`/`setLogger` seams in the new `"web cli: createBoardSource gets the host sink, its build port serves, close runs on stop"` test; `test/web-stream.test.ts` uses no timers at all | PASS |
| `px web` serves live board data through the composition root (production `BoardProjectionBuilder`, command-boundary progress sink) | `"web cli: createBoardSource gets the host sink, its build port serves, close runs on stop"` in `test/web-host.integration.test.ts`; `createBoardSource` wiring in `src/composition/create-cli.ts` (`web` entry) + `runWebCommand` in `src/interfaces/cli/web.ts`; live smoke of `npm run dev -- web` observed `GET /api/board` 200 with real board data and a live `invalidate` SSE frame | PASS |
| The web layer never constructs read adapters itself; the build port comes from composition (ADR 0051) | `WebBoardSource.buildProjection` in `src/interfaces/cli/web.ts` is supplied by `createProductionApplicationServices` in `src/composition/create-cli.ts`; `src/interfaces/web/host.ts` imports only the `BoardProjection` type from the application layer | PASS |
| Disconnection and close leave no live streams (mission: "a closed host leaves no registered listeners and no live subscription") | `stream.clearListeners()` + client `detach` loop in `close()` of `src/interfaces/web/host.ts`; proven by the disconnect/close test above and `"web stream: clearListeners drops every subscriber"` in `test/web-stream.test.ts` | PASS |
| `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` pass | Gates run in CP-5 | PENDING (CP-5) |

Next action: CP-5 — run `./scripts/verify-local.sh all` then `./scripts/verify-local.sh static-analysis`, and add the grep-backed proof that nothing under `src/interfaces/web/` or `src/adapters/web/` imports SQLite, Git, `node:child_process`, `node:fs` watch, or a `/proc` reader, plus confirm `WEB_TRANSPORT_VERSION` is still `1 as const`.

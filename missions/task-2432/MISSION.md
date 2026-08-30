# Mission: Stream authoritative board snapshots and progress with reconnect (task-2432)

## Goal
Add the read-only local transport that turns the TASK-2430 wire contract (ADR 0055) into two live routes on the existing loopback host (ADR 0054): a `GET` board-snapshot endpoint built from the production `BoardProjectionBuilder`, and a Server-Sent Events stream that carries typed progress events plus "projection changed; refetch the snapshot" invalidations. Truth is always re-established by fetching a fresh snapshot; SSE and browser memory are notification state only.

## Why Now
TASK-2430 (`src/interfaces/web/transport.ts`) defines `WebBoardSnapshot`, `WebProgressEvent`, and their converters, and TASK-2431 shipped the loopback-only Fastify host (`src/interfaces/web/host.ts`) that today serves only browser assets and answers 405 for every state-changing method. Both dependencies are completed, so the contract and the host exist with nothing connecting them to real board data. The browser shell (TASK-2434) and the mutation endpoint (TASK-2433) both build on this read path, so the read transport must land first — and it must land with the reconnect and boundedness rules baked in, before a UI starts treating SSE history as authority.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is; TASK-2430 and TASK-2431 are both in `backlog/completed/`, so no precondition remains.
- Main drivers: new snapshot route plus SSE endpoint on the existing Fastify host; a per-process event-id/broadcast seam with a bounded replay buffer; wiring `composeBoardProjection` and the `BoardProgressSink` into the web adapter; deterministic tests for reconnect/Last-Event-ID dedup, transient rebuild failure, disconnect cleanup, and buffer eviction.

## Scope
- Add a read-only `GET` snapshot route to `createWebHost` that returns a `WebBoardSnapshot` produced by `toWebBoardSnapshot` from a `BoardProjection` built by the production `BoardProjectionBuilder` (composed via `composeBoardProjection`), injected into the host as a port — the web adapter never constructs read adapters itself.
- Add a read-only `GET` SSE route that emits two event types: `progress` (a `WebProgressEvent` from `toWebProgressEvent`) and a projection-invalidation event that carries no board payload, only "refetch".
- Assign monotonically increasing integer event IDs from a single per-host-process counter, and honour the `Last-Event-ID` request header on reconnect by replaying only buffered events with a strictly greater ID.
- Drive invalidation from the existing `subscribeToBoardProjection` seam in `src/application/projections/board-subscription.ts`, with a single subscription per host shared by all connected clients.
- Feed progress from the existing command-boundary `BoardProgressSink` / `OperationEvent` (`src/application/controller/board-command.ts`); reuse the existing `operationId` and `sequence` values without inventing a second identity scheme.
- Bound the in-memory replay buffer to an explicit constant, evicting oldest-first, and expose the bound as a named export so the eviction test asserts against it rather than a magic number.
- Remove every per-client listener, timer, and stream on client disconnect and on `host.close()`; a closed host leaves no registered listeners and no live subscription.
- Surface a transient projection-build failure as a typed error response / error event, never as an empty board, and keep the subscription alive so the next tick recovers.
- Wire the new host ports through `src/interfaces/cli/web.ts` and the composition root so `px web` serves live board data.
- Add deterministic tests using injected timer/clock seams for: initial snapshot, invalidation on change, progress ordering, reconnect dedup via `Last-Event-ID`, transient rebuild error, disconnect/close cleanup, and buffer eviction under high-volume synthetic progress.

## Out of Scope
- Any mutation route, WebSocket, or bidirectional RPC; mutations stay POST and belong to TASK-2433.
- Any login, account, bearer token, session check, or CSRF requirement on these GET routes; the loopback bind and exact-Host check from TASK-2431 remain the whole boundary.
- The React board shell, rendering, or client-side state (TASK-2434, TASK-2435).
- New SQLite, Git, filesystem, or process watchers/pollers in web code; a second event bus; a daemon or additional long-lived process.
- Persisting SSE cursors, event history, or browser state as workflow state on disk or in SQLite.
- Changing `WEB_TRANSPORT_VERSION`, the ADR 0055 envelope shapes, or the existing `BoardProjection` read models.
- Changing the loopback bind literals, the CSP/protection headers, or the `px.mjs` 5 MB stop rule.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A `GET` request to the snapshot route returns HTTP 200 with a body that `validateWebBoardSnapshot` accepts, carrying `kind: 'board-snapshot'`, `transportVersion` equal to `WEB_TRANSPORT_VERSION`, and a `projectionVersion` taken from the `BoardProjection` produced by `BoardProjectionBuilder`.
- The snapshot and SSE routes return 200 for a request that carries no cookie, no `x-px-csrf` header, and no `Origin` header, while a request whose `Host` header does not equal the bound loopback host and port is rejected with 403.
- SSE frames carry `id:` values that strictly increase within one host process across both `progress` and invalidation events, drawn from one counter shared by all connected clients.
- A reconnect that sends `Last-Event-ID: <n>` receives only events with id `> n`; a test that connects, receives k events, disconnects, and reconnects with the last id observes zero repeated `operationId`+`sequence` pairs.
- No file under `src/interfaces/web/` or `src/adapters/web/` imports a SQLite, Git, `node:child_process`, `node:fs` watch, or `/proc` reader; board change detection reaches the host only through `subscribeToBoardProjection`, asserted by a test that counts builds driven by an injected timer seam.
- Emitted progress events reuse the `operationId` and `sequence` from the command boundary's `OperationEvent`/`ProgressEvent` unchanged, and each is a payload `validateWebProgressEvent` accepts.
- When the injected projection build rejects, the snapshot route responds with a typed error status (not 200 with an empty board) and the SSE stream emits a typed error event; the subscription is not torn down, and the next successful tick emits an invalidation — proven by a test that fails one build then succeeds.
- After a client disconnects, the host holds zero listeners and zero timers for that client; after `host.close()`, the projection subscription is unsubscribed and no timer remains scheduled, asserted against counters on the injected timer seam.
- The replay buffer has an exported numeric bound; pushing bound+50 synthetic progress events leaves exactly `bound` retained, oldest evicted first, with no code path performing `array = [...array, event]` unbounded growth.
- A high-volume synthetic progress test drives at least 1000 events through the stream with no real agent process and no real sleep, and asserts both the buffer length ceiling and a constant listener count.
- Every new test drives time through injected timer/clock seams; no new test calls a real `setTimeout`-based sleep.
- `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` pass on the final tree.

## Risks and Assumptions
- Assumption: `composeBoardProjection` in `src/composition/board-projection.ts` can supply a `build(): Promise<BoardProjection>` closure to the web host without the interfaces layer importing concrete adapters (the same shape `subscribeToBoardProjection` already takes).
- Risk: Fastify's reply stream can buffer or compress SSE; the implementation must set `content-type: text/event-stream`, `cache-control: no-store`, and disable buffering, and a test must assert frames arrive before the response ends.
- Risk: the existing `onSend` hook adds protection headers to every response, and the CSP `connect-src 'self'` must still permit the same-origin EventSource — assert the SSE response headers rather than assuming inheritance is harmless.
- Risk: `subscribeToBoardProjection` fires only when `boardFingerprint` changes, so a progress-only change may produce no invalidation; the mission treats that as correct and tests must not assert an invalidation per progress event.
- Risk: one shared subscription plus many clients makes disconnect accounting the leak point; refcount subscribers and assert the count reaches zero.
- Assumption: 2-second `BOARD_REFRESH_INTERVAL_MS` polling is acceptable latency for invalidation; no watcher is added to reduce it.

## Checkpoints
- CP 1: Map the seams and record the decision. Identify how `composeBoardProjection` and the `BoardProgressSink` reach `createWebHost` as injected ports, the exact route paths, the SSE event names, the replay-buffer bound constant, and the timer seam each test will drive. No production behaviour change yet.
- CP 2: Implement the snapshot route: port injection into `WebHostOptions`, `toWebBoardSnapshot` conversion, typed error response on build failure, and tests for a valid snapshot, an unauthenticated (no cookie/CSRF/Origin) 200, a wrong-`Host` 403, and a failing build that does not return an empty board.
- CP 3: Implement the SSE route: shared per-process id counter, bounded replay buffer with oldest-first eviction, `Last-Event-ID` replay, progress events from the command boundary, invalidation events from `subscribeToBoardProjection`, and typed error events. Tests cover id monotonicity, ordering, reconnect dedup, and eviction at the exported bound.
- CP 4: Implement and prove teardown plus load behaviour: per-client listener/timer removal on disconnect, subscription unsubscribe on `host.close()`, and the high-volume synthetic progress test asserting constant listener count and the buffer ceiling. Wire `px web` through `src/interfaces/cli/web.ts` and the composition root.
- CP 5: Run the gates, and prove no presentation adapter reads SQLite, Git, or processes directly (grep-backed assertion over `src/interfaces/web/` and `src/adapters/web/`), plus confirm `WEB_TRANSPORT_VERSION` is unchanged.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST lead its evidence with the durable references Parallix verifies today: exact test names, ADR references (ADR 0054, ADR 0055, ADR 0051), existing or new `test/` file paths, and recognized repository commands or paths such as `` `npm test -- test/web-transport.test.ts` ``, `` `node ...` ``, `` `git ...` ``, `` `px web` ``, or `` `./scripts/verify-local.sh all` ``. File:line references are accepted when needed, but are discouraged because line numbers rot as unrelated edits land — cite the file plus the symbol name instead.

Each `CP-N.md` MUST contain a summary of the work done, then the exact heading `## Goal Check`, then this 3-column pipe-delimited table:

| Criterion | Evidence | Status |
|---|---|---|
| Each mission success criterion, quoted or paraphrased | Exact test name, `test/` path, ADR reference, or runnable repository command | PASS / FAIL / PENDING |

Include at least one evidence row per success criterion the checkpoint touches, and finish with a non-generic `Next action:` line naming the next concrete step.

Weak-agent failure mode to avoid: raw `stat` or `ls` output, a screenshot of a passing terminal, or generic prose such as "verified the stream works" is NOT sufficient evidence on its own. Shell output may appear as supplemental context only when paired with one of the accepted references above — for example, pair the run log with the test name `"SSE reconnect with Last-Event-ID replays only newer events"` and the file `test/web-stream.test.ts`.

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not modify `src/interfaces/web/transport.ts` envelope shapes, `WEB_TRANSPORT_VERSION`, or `SUPPORTED_WEB_TRANSPORT_VERSIONS`; this mission consumes the TASK-2430 contract, it does not renegotiate it.
- Do not weaken `src/interfaces/web/security.ts` or the `PROTECTION_HEADERS` / loopback bind / exact-Host checks in `src/interfaces/web/host.ts`.
- Do not add authentication, sessions, bearer tokens, or CSRF requirements to these GET routes, and do not add any mutation route (TASK-2433 owns that).
- Do not import SQLite, Git, `node:child_process`, or filesystem watchers into `src/interfaces/web/` or `src/adapters/web/`.
- Do not change `subscribeToBoardProjection`'s public signature, `BOARD_REFRESH_INTERVAL_MS`, or the `BoardProjection` read models to suit the wire format.
- Do not add a new runtime npm dependency (an SSE library, an event-bus package, a state framework); the existing Fastify reply stream is sufficient.
- Do not change the `px.mjs` 5 MB stop rule.

## Stop Rules
- Stop and seek direction if serving SSE correctly appears to require a WebSocket, a second process/daemon, or a new runtime dependency.
- Stop and seek direction if delivering fresh board data appears to require a direct SQLite/Git/process watcher in web code rather than the `subscribeToBoardProjection` seam.
- Stop and seek direction if honouring `Last-Event-ID` appears to require persisting cursors or event history to disk or SQLite.
- Stop and seek security review if these read routes cannot stay side-effect-free and unauthenticated within the existing loopback + exact-Host boundary.
- Stop before widening scope into the browser shell, mutation endpoint, or any UI work; those are TASK-2433, TASK-2434, and TASK-2435.

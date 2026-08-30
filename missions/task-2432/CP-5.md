# CP-5: Gates green; no presentation adapter reads SQLite, Git, or processes

## Work done

- Repaired the one static-analysis failure from the final tree: the
  `createBoardSource` parameter in the `WebCliOptions` interface in
  `src/interfaces/cli/web.ts` is a documentation name in a type literal, so
  it now carries the repo's `_` unused-arg prefix (`_progress`), matching
  the convention already used in `src/interfaces/web/stream.ts` and
  `src/application/projections/board-subscription.ts`.
- Re-ran both mission gates on the final tree:
  - `./scripts/verify-local.sh all` — 2251 pass, 0 fail (45 suites).
  - `./scripts/verify-local.sh static-analysis` — ALL STAGES PASSED
    (ESLint, `npm run typecheck`, test-hygiene, test typecheck).
- Grep-backed boundary proof (re-runnable against the committed tree):
  `grep -rnE "node:sqlite|node:child_process|execSync|spawn|node:fs|watch\(|/proc" src/interfaces/web/ src/adapters/web/`
  matches exactly one pre-existing line — `src/adapters/web/asset-store.ts`
  `import * as fs from 'node:fs'` — which loads integrity-verified packaged
  browser assets once at startup via `fs.readFileSync` (no watch, no board
  state). That file dates from TASK-2431 (commit `1160b7c51`) and is
  unmodified by this mission (`git log --oneline -- src/adapters/web/asset-store.ts`).
  Nothing under either web directory imports SQLite, Git,
  `node:child_process`, a filesystem watcher, or a `/proc` reader; board
  change detection reaches the host only through
  `subscribeToBoardProjection` (`src/application/projections/board-subscription.ts`),
  driven in tests by the injected `setTimer`/`clearTimer` seam with
  set/clear counters asserted in
  `"web host: a disconnect removes that client, and close() unsubscribes the projection"`.
- `WEB_TRANSPORT_VERSION` unchanged:
  `grep -n "WEB_TRANSPORT_VERSION = " src/interfaces/web/transport.ts`
  reports `1 as const` (line 58), and
  `git diff 163062bfe^..HEAD -- src/interfaces/web/transport.ts` (whole
  mission) reports no change to the file.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `GET` snapshot route returns 200 with a body `validateWebBoardSnapshot` accepts: `kind: 'board-snapshot'`, `transportVersion` = `WEB_TRANSPORT_VERSION`, `projectionVersion` from the production `BoardProjection` | `"web host: snapshot route returns a valid versioned board snapshot"` in `test/web-host.integration.test.ts` (asserts all three fields via the validator) | PASS |
| Snapshot and SSE routes return 200 with no cookie, no `x-px-csrf`, no `Origin`; a non-loopback `Host` is rejected 403 | `"web host: snapshot route answers 200 without cookie, CSRF header, or Origin"`, `"web host: snapshot route rejects a Host header that is not the bound loopback origin"`, `"web host: SSE route answers without cookie, CSRF header, or Origin but rejects a wrong Host"` — all in `test/web-host.integration.test.ts` | PASS |
| SSE `id:` values strictly increase within one host process across both event types, one shared counter | `"web stream: one counter issues strictly increasing ids across every event name"` in `test/web-stream.test.ts`; `"web host: SSE ids strictly increase across progress and invalidation events"` in `test/web-host.integration.test.ts` (ids `[1,2,3,4]` interleaving progress/invalidate over a live socket) | PASS |
| Reconnect with `Last-Event-ID: <n>` receives only ids `> n`; zero repeated `operationId`+`sequence` pairs | `"web stream: reconnect with Last-Event-ID replays only newer events"` in `test/web-stream.test.ts`; `"web host: SSE reconnect with Last-Event-ID replays only newer events"` in `test/web-host.integration.test.ts` (connect → 2 events → disconnect → 2 missed → reconnect replays exactly ids `[3,4]`, no duplicate pair) | PASS |
| No file under `src/interfaces/web/` or `src/adapters/web/` imports SQLite, Git, `node:child_process`, a `node:fs` watch, or a `/proc` reader; board change detection only via `subscribeToBoardProjection`, asserted by tests counting builds against the injected timer seam | `grep -rnE "node:sqlite|node:child_process|execSync|spawn|node:fs|watch\(|/proc" src/interfaces/web/ src/adapters/web/` → only pre-existing static `fs.readFileSync` asset loading in `src/adapters/web/asset-store.ts` (TASK-2431, no watch); build/teardown counting via `manualTimers()` counters in `"web host: a disconnect removes that client, and close() unsubscribes the projection"` and `"web host: SSE ids strictly increase across progress and invalidation events"` in `test/web-host.integration.test.ts` | PASS |
| Emitted progress events reuse the command boundary's `operationId`/`sequence` unchanged; each payload is `validateWebProgressEvent`-accepted | `"web stream: progress frames carry the command boundary operationId and sequence unchanged"` in `test/web-stream.test.ts`; `"web host: SSE stream sends streaming and protection headers and frames before the response ends"` asserts `validateWebProgressEvent(frame.data).ok` on a live frame | PASS |
| A rejected projection build yields a typed error (not a 200 empty board) on the snapshot route and a typed error event on the stream; the subscription survives and the next tick invalidates | `"web host: a failing projection build surfaces an error, never an empty board"` (503 `board-snapshot-error`/`unavailable`, second read recovers with 3 active cards) and `"web host: a failed rebuild emits a typed stream error and the next tick still invalidates"` (timer seam still scheduled after the failure) — both in `test/web-host.integration.test.ts` | PASS |
| After disconnect: zero listeners/timers per client; after `host.close()`: subscription unsubscribed, no timer scheduled | `"web host: a disconnect removes that client, and close() unsubscribes the projection"` in `test/web-host.integration.test.ts` — `clientCount()` 2→1→0, disconnected client receives nothing, `clearCount === 1`, `scheduled === false`, `setCount` unchanged by close, all on the injected timer seam counters | PASS |
| Replay buffer has an exported numeric bound; bound+50 pushes leave exactly `bound` retained, oldest evicted first, no unbounded `array = [...array, event]` growth | `WEB_EVENT_BUFFER_LIMIT` exported from `src/interfaces/web/stream.ts`; `"web stream: the replay buffer stops at the exported bound and evicts oldest first"` in `test/web-stream.test.ts`; the buffer is mutated in place (`push`/`shift`) in `createWebEventStream` | PASS |
| ≥1000 synthetic progress events with no real agent process and no real sleep, asserting the buffer ceiling and a constant listener count | `"web host: 1000 synthetic progress events keep one listener and a bounded buffer"` (real socket, constant `clientCount()`, stale cursor replays exactly `WEB_EVENT_BUFFER_LIMIT`) and `"web stream: high-volume progress keeps the buffer and listener count constant"` — `test/web-host.integration.test.ts` and `test/web-stream.test.ts` | PASS |
| Every new test drives time through injected timer/clock seams; no new test calls a real `setTimeout`-based sleep | `manualTimers()` in `test/web-host.integration.test.ts` drives `BoardSubscriptionOptions.setTimer`/`clearTimer`; `waitForStop` + `setLogger` seams in the `"web cli: createBoardSource gets the host sink, its build port serves, close runs on stop"` test; `test/web-stream.test.ts` uses no timers | PASS |
| `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` pass on the final tree | `./scripts/verify-local.sh all` → 2251 pass, 0 fail; `./scripts/verify-local.sh static-analysis` → ALL STAGES PASSED (both re-run after the final edit) | PASS |
| Restricted areas held: `WEB_TRANSPORT_VERSION` and ADR 0055 envelopes unchanged; no auth/CSRF/mutation routes added; no new runtime dependency | `grep -n "WEB_TRANSPORT_VERSION = " src/interfaces/web/transport.ts` → `1 as const`; `git diff 163062bfe^..HEAD --stat -- src/interfaces/web/transport.ts package.json` → no changes to the envelope file or dependencies | PASS |

Next action: mission complete — all five checkpoints committed and both gates green on the final tree; hand off to Parallix for review (no lifecycle commands run by the implementer).

# CP-2: Pure DTO conversion, validation, and focused unit tests

## Summary

Implemented the wire contract as one pure module, `src/interfaces/web/transport.ts`
(interfaces layer; imports application read models and the capability registry
helpers only — no node builtins, no network, no React):

- Versioned envelopes: `kind` tag + `transportVersion` on the snapshot
  (`board-snapshot`), command result (`command-result`), and progress
  (`progress`) DTOs; the snapshot also carries `projectionVersion`.
  `WEB_TRANSPORT_VERSION = 1`.
- Converters: `toWebBoardSnapshot`, `toWebCommandResult`, `toWebProgressEvent`
  — pure projections of `BoardProjection`, `ApplicationOutcome`, and
  `ProgressEvent`, reusing `projectMissionActivity` for mission activity and
  `isIntegratedCapability` / `unavailableReason` for action states. No
  lifecycle, ranking, liveness, or lane policy is recomputed.
- Fail-closed: `WebTransportError` (`unsupported-projection-version`,
  `non-finite-number`, `unsafe-value`) rejects unknown projection versions,
  non-finite durations, and outcome values that are `Error`, `Set`, `Map`,
  function, `Symbol`, `BigInt`, non-finite, or `undefined`-dependent.
- Validators: `validateWebBoardSnapshot`, `validateWebCommandResult`,
  `validateWebProgressEvent` — strict key-shape checks that return either
  `{ ok: true }`, an explicit `{ ok: false, code: 'incompatible-client' }`
  for unsupported transport versions, or `{ ok: false, code:
  'invalid-payload', problems }`. Unexpected keys (e.g. `error.stack`) are
  rejected.

Added `test/web-transport.test.ts` (16 tests, node:test, fixture reuse from
`test/fixtures/board-projection.ts`) and ADR 0055
(`docs/adr/0055-web-board-transport-contract.md`, indexed in
`docs/adr/index.md`) recording the durable contract decision.

Verified locally: `npx tsc --noEmit` passes, `npx eslint` passes on both new
files, and `npx tsx --test test/web-transport.test.ts` passes 16/16 in ~0.5 s.

## Application fact → wire representation (with covering test)

| Application fact | Wire representation | Covering test (`test/web-transport.test.ts`) |
|---|---|---|
| `blockedForMs === Infinity` | `{ "kind": "indefinite" }` — never wire `null` | `indefinite agent block projects to a dedicated indefinite wire representation, never null` |
| `blockedForMs` finite (0, 1500) | `{ "kind": "finite", "ms": <n> }` | `indefinite agent block projects to a dedicated indefinite wire representation, never null` |
| `runningSessions` key absent | key omitted | `running sessions distinguish unobserved, observed-none, and a positive count` |
| `runningSessions === null` (liveness not observed) | `null` | `running sessions distinguish unobserved, observed-none, and a positive count` |
| `runningSessions === 0` (probe ran, none running) | `0` | `running sessions distinguish unobserved, observed-none, and a positive count` |
| `runningSessions === n` | `n` | `running sessions distinguish unobserved, observed-none, and a positive count` |
| `unattributedRunningSessions` absent / `null` / `n` | omitted / `null` / number | `unattributed running sessions keep the same three-state encoding` |
| work `freshness: 'live' \| 'unverified' \| 'stale'` | `activity.work.certainty: 'live' \| 'unknown' \| 'stale'` | `mission work activity preserves live, unconfirmed, stale, blocked, and idle liveness` |
| no work + blocking reason | `{ kind: 'blocked', reason }` | `mission work activity preserves live, unconfirmed, stale, blocked, and idle liveness` |
| no work, no reason | `{ kind: 'idle' }` | `mission work activity preserves live, unconfirmed, stale, blocked, and idle liveness` |
| `liveSession` absent / `null` / session | coordinator `{ state: 'unknown' }` / `{ state: 'stopped' }` / `{ state: 'live', family: string\|null }` | `coordinator evidence distinguishes unknown, stopped, and live` |
| kind not in integrated capabilities | action `{ state: 'unavailable', reason }` (registry reason, server-owned) | `action DTO distinguishes an unavailable action from an ineligible action` |
| integrated, `enabled === false` | `{ state: 'ineligible', reason }` (lane reason, server-owned) | `action DTO distinguishes an unavailable action from an ineligible action` |
| integrated, `enabled === true` | `{ state: 'enabled', reason: null }` + exact display | `enabled action DTO carries null reason and exact display text`, `attention action keeps the server-owned display text and state` |
| optional field absent (progress/log `agent?`, source-fact `value?`) | key omitted, never `null` | `snapshot DTO round-trips through JSON.stringify and JSON.parse without losing shape`, `progress event DTO is versioned and validated` |
| nullable field `null` (card `agent`, `checkpoint`, action `reason`…) | `null` | `snapshot DTO round-trips through JSON.stringify and JSON.parse without losing shape`, `enabled action DTO carries null reason and exact display text` |
| `ApplicationOutcome.error` | `{ kind, message }` exactly — no stack | `command result wire error carries kind and message only, never a stack` |
| `value` = `Error`/`Map`/`BigInt`/`{ x: undefined }` | converter rejects (`unsafe-value`) | `command result conversion rejects an arbitrary thrown object as value` |
| `value` = `NaN`/`Infinity` (top-level or nested) | converter rejects (`non-finite-number`) | `command result conversion rejects non-finite values and keeps safe ones` |
| `projection.version !== 1` | converter rejects (`unsupported-projection-version`) | `unsupported projection version is rejected before conversion` |
| payload `transportVersion` unsupported | `{ ok: false, code: 'incompatible-client', field, received, supported }` | `unsupported transport version is rejected as an incompatible client` |
| payload with unexpected key (`error.stack`) or wrong literal | `{ ok: false, code: 'invalid-payload', problems }` | `command result wire error carries kind and message only, never a stack`, `progress event DTO is versioned and validated` |
| whole snapshot (all DTOs above) | `JSON.stringify` → `JSON.parse` deep-equal, only finite numbers | `snapshot DTO round-trips through JSON.stringify and JSON.parse without losing shape` |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 JSON-safe versioned snapshot | `test/web-transport.test.ts` — test `"snapshot DTO round-trips through JSON.stringify and JSON.parse without losing shape"` (round trip + full walker over parsed payload); module `src/interfaces/web/transport.ts` | PASS |
| SC2 indefinite block encoding | `test/web-transport.test.ts` — test `"indefinite agent block projects to a dedicated indefinite wire representation, never null"`; mapping table row 1 | PASS |
| SC3 session-count + liveness distinctions | `test/web-transport.test.ts` — tests `"running sessions distinguish unobserved, observed-none, and a positive count"`, `"unattributed running sessions keep the same three-state encoding"`, `"mission work activity preserves live, unconfirmed, stale, blocked, and idle liveness"`, `"coordinator evidence distinguishes unknown, stopped, and live"` | PASS |
| SC4 server-owned action DTOs | `test/web-transport.test.ts` — tests `"action DTO distinguishes an unavailable action from an ineligible action"`, `"enabled action DTO carries null reason and exact display text"`, `"attention action keeps the server-owned display text and state"`; registry reused from `src/application/controller/board-command.ts`, not duplicated | PASS |
| SC5 versioned/validated results + progress, no stack traces, incompatible-client state | `test/web-transport.test.ts` — tests `"command result conversion rejects an arbitrary thrown object as value"`, `"command result conversion rejects non-finite values and keeps safe ones"`, `"command result wire error carries kind and message only, never a stack"`, `"unsupported transport version is rejected as an incompatible client"`, `"progress event DTO is versioned and validated"` | PASS |
| SC6 pure conversion, no server/UI added | `test/web-transport.test.ts` — test `"conversion is pure: the source projection is not mutated and the output is deterministic"`; `src/interfaces/web/transport.ts` has no node builtins, no Fastify/React imports; no file under `web/` or HTTP transport modified in this checkpoint | PASS |
| Durable contract rationale in ADR | `docs/adr/0055-web-board-transport-contract.md` (ADR 0055), indexed in `docs/adr/index.md` | PASS |
| Static checks on new files | `npx tsc --noEmit`, `npx eslint src/interfaces/web/transport.ts test/web-transport.test.ts` (both pass on this tree); full gate in CP 3 via `./scripts/verify-local.sh all` | PASS |

Next action: CP 3 — confirm the mission diff contains no adapter/network/UI work, run `./scripts/verify-local.sh all` to the green, refresh the knowledge graph, and complete the final goal-check evidence table in CP-3.md.

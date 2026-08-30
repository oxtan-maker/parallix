# CP-1: Source-to-wire mapping for the versioned web board transport contract

## Summary

Mapped every application fact the browser contract must carry to its wire
representation, using only the existing read models — no new policy, no
recomputed liveness, no new state. The contract will live in
`src/interfaces/web/transport.ts` (interfaces layer; the boundary guard allows
interfaces to import application and domain). All conversion is pure; the
module imports no node builtins, no Fastify, no React.

Sources read and confirmed sufficient for projection without policy changes:

| Source | Path | Facts projected |
|---|---|---|
| `BoardProjection`, `BOARD_PROJECTION_VERSION` | `src/application/projections/board.ts` | version, repositoryId, stages/cards, attention queue, board `availableActions`, wip counts, operation log, `sourceFacts`, `metrics.agentAvailability`, `metrics.unattributedRunningSessions` |
| `MissionCard`, `LiveMissionWork`, `CommandAvailability`, `agentIsWorking` | `src/application/projections/mission-board.ts` | card state, gate, checkpoint fields, per-card `commands`, freshness |
| `projectMissionActivity`, `MissionWorkActivity`, `CoordinatorEvidence` | `src/application/projections/mission-activity.ts` | per-mission work liveness (live/unknown/stale/blocked/idle) and coordinator evidence (live/stopped/unknown) — reused as-is, not re-derived |
| `AgentAvailabilityMetric` | `src/application/projections/board.ts` | family availability, `blockedForMs` (may be `Infinity`), `runningSessions?: number \| null` |
| `blockedForMs()`, `AgentBlock` | `src/domain/agents.ts` | confirms `Infinity` is the domain's indefinite-block value |
| `INTEGRATED_CAPABILITIES`, `UNAVAILABLE_CAPABILITIES`, `isIntegratedCapability`, `unavailableReason` | `src/application/controller/board-command.ts` | server-owned unavailable-vs-ineligible decision; reused, not duplicated |
| `ApplicationOutcome`, `ApplicationError`, `DurableEvidence`, `ProgressEvent` | `src/application/contracts.ts` | typed command outcomes and progress |

Deliberately excluded from the v1 wire snapshot: the flow-metric series
(`cumulativeFlow`, `medianStateTimes`, cohorts, bottleneck) and card
`reviewHistory`/`pullRequest`/`labels`. The mission scope names board state,
mission activity, available actions, and typed outcomes; every special-value
regression case in the backlog lives in `agentAvailability`, cards, actions,
and outcomes — none in the metric series. ADR 0055 records this as a
reconsideration trigger, not a v1 field.

## Versioning design

- `WEB_TRANSPORT_VERSION = 1` is stamped on every DTO envelope
  (`kind: 'board-snapshot' | 'command-result' | 'progress'` +
  `transportVersion`).
- The snapshot additionally carries `projectionVersion` (the
  `BoardProjection.version` it was projected from). The converter rejects a
  projection whose version it does not know (fail closed at the source).
- Validators (used on any parsed payload) reject a `transportVersion` outside
  the supported set with an explicit `incompatible-client` state — not a
  generic invalid-payload error. The exact HTTP response shape stays with the
  transport mission (TASK-2429); this contract only defines the state.

## Application fact → wire representation

| Application fact | Wire representation |
|---|---|
| `blockedForMs === Infinity` (agent block `kind: 'indefinite'`) | `{ "kind": "indefinite" }` — dedicated tagged value; never wire `null`, never an unknown duration |
| `blockedForMs` finite ≥ 0 | `{ "kind": "finite", "ms": <number> }` |
| `blockedForMs` non-finite but not `Infinity` (NaN, −∞) | converter rejects (`WebTransportError`); the domain cannot produce these, fail closed |
| `runningSessions` key absent (metric built without a liveness probe) | key omitted on the wire |
| `runningSessions === null` (liveness could not be observed) | `null` — unknown, never rendered as zero |
| `runningSessions === 0` (probe ran, nothing running) | `0` |
| `runningSessions === n` (n > 0) | `n` |
| `unattributedRunningSessions` absent / `null` / `n` | same three-state encoding: omitted / `null` / number |
| `LiveMissionWork.freshness === 'live'` | `activity.work = { kind: 'working', certainty: 'live', phase, summary, agent: string\|null, operationId }` |
| `LiveMissionWork.freshness === 'unverified'` | same shape with `certainty: 'unknown'` (the operator word "unconfirmed" is display text, not wire data) |
| `LiveMissionWork.freshness === 'stale'` | same shape with `certainty: 'stale'` |
| `currentWork === null` with `blockingReason` set | `activity.work = { kind: 'blocked', reason }` |
| `currentWork === null` without blocking reason | `activity.work = { kind: 'idle' }` |
| `liveSession` absent (`undefined` — scan never ran) | `activity.coordinator = { state: 'unknown' }` |
| `liveSession === null` (scan ran, no live session) | `{ state: 'stopped' }` |
| `liveSession` present | `{ state: 'live', family: string \| null }` (unattributable family stays `null`) |
| command kind not in `INTEGRATED_CAPABILITIES` (e.g. `review:submit`) | action `{ state: 'unavailable', reason }` with the registry-documented reason, regardless of lane — server decides, client never sees the registry |
| integrated kind with `CommandAvailability.enabled === true` | `{ state: 'enabled', reason: null }` |
| integrated kind with `enabled === false` | `{ state: 'ineligible', reason }` carrying the server-computed lane/lifecycle reason |
| optional field absent (e.g. progress `agent?`, log-entry `agent?`) | key omitted — absent means "not applicable", never `null` |
| nullable field `null` (card `agent`, `checkpoint`, `gate` reason, `blockedReason`) | `null` — present-but-empty, distinct from omitted |
| `AgentAvailabilityMetric.reason` absent or `null` (no semantic difference) | normalized to `reason: null` |
| `SourceFact.value` absent / present | key omitted / string |
| `ApplicationOutcome.error` (`ApplicationError { kind, message }`) | `{ kind: <ErrorKind>, message }` exactly — the wire error object has no `stack` and no extra keys |
| `ApplicationOutcome.value` is an `Error` instance, `Set`, `Map`, function, `Symbol`, `BigInt`, non-finite number, or object with an `undefined` property | converter rejects (`WebTransportError`, fail closed) — nothing unsafe crosses the wire |
| `ApplicationOutcome.value` JSON-safe | included unchanged under `value` |
| `ApplicationOutcome.value` absent (`undefined`) | `value` key omitted |
| `BoardProjection.version !== 1` | converter rejects (`unsupported-projection-version`) |
| parsed payload `transportVersion` not in supported set | validator returns `{ ok: false, code: 'incompatible-client', field: 'transportVersion', received, supported }` |
| parsed payload with unexpected keys (e.g. `error.stack`) or wrong literal types | validator returns `{ ok: false, code: 'invalid-payload', problems }` |
| parsed payload containing a non-finite number | validator rejects (non-finite number is not representable and not allowed) |

## Action DTO shape

Every rendered action (attention action and per-card command) is one DTO:
`{ kind, display, state, reason }` where `kind` is the server-owned
`BoardCommandKind`, `display` is the exact command text
(e.g. `px review task-1234`), `state` is `enabled | ineligible | unavailable`,
and `reason` is non-null exactly when state is not `enabled`. Board-level
`availableActions` use the same DTO with `display` `px <command>`. Card
command → kind: `active→active:execute`, `handoff→handoff:record`,
`review→review:submit`, `integrate→integrate:merge`, `draft→draft:create`;
attention actions keep their existing `attentionAction` display strings.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Sources for snapshot, activity, actions, outcomes identified | `src/application/projections/board.ts`, `src/application/projections/mission-activity.ts`, `src/application/controller/board-command.ts`, `src/application/contracts.ts` | PASS |
| `Infinity` mapping defined | table row: `blockedForMs === Infinity` → `{ "kind": "indefinite" }`; domain source `blockedForMs()` in `src/domain/agents.ts` | PASS |
| unknown / observed-none / zero / omitted mappings defined | table rows for `runningSessions` and `unattributedRunningSessions` (omitted / `null` / `0` / `n`) | PASS |
| liveness state mappings defined | table rows for `freshness` → `certainty` and `liveSession` → coordinator `state` (live, unknown, stale, blocked, idle all named) | PASS |
| unavailable vs ineligible mapping defined | table rows keyed on `INTEGRATED_CAPABILITIES` / `CommandAvailability.enabled` from `src/application/controller/board-command.ts` | PASS |
| version + fail-closed mapping defined | versioning design section: `transportVersion`, `projectionVersion`, `incompatible-client` validator state | PASS |
| JSON-safety boundary defined | table rows for `ApplicationOutcome.value` rejection classes and non-finite validator rejection | PASS |
| No lifecycle/lane/capability behavior altered by the mapping | mapping reuses `projectMissionActivity`, `isIntegratedCapability`, `unavailableReason` unchanged; no source file modified in this checkpoint | PASS |

Next action: implement `src/interfaces/web/transport.ts` (DTO types, pure converters `toWebBoardSnapshot` / `toWebCommandResult` / `toWebProgressEvent`, strict validators, `WebTransportError`) plus `test/web-transport.test.ts` covering every table row above, and record the durable contract decision in ADR 0055.

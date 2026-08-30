# ADR 0055: Versioned JSON-safe web board transport contract

## Status

Accepted — 2026-08-28

Related: ADR 0054 (local web-board adapter), ADR 0051 (application
boundary), ADR 0048 (fail-closed harness), TASK-2430, TASK-2433

## Context

ADR 0054 decides that a Fastify loopback adapter returns projections to a
React browser client. It does not define what crosses the wire: the
application read models (`BoardProjection` and its card, activity, and
outcome types) are UI-neutral and were built for in-process TUI consumers.

Passing those objects through `JSON.stringify` is lossy in ways the board
actually exercises:

- An indefinite agent block is the number `Infinity` in the domain; JSON
  would serialize it to `null` and the browser would read "no block".
- Session counts carry three source states — no liveness probe ran
  (absent), the probe ran but liveness could not be observed (`null`), and
  the probe ran and nothing is running (`0`) — and JSON cannot tell absent
  from `null` after a round trip unless the wire keeps both distinct.
- Optional fields (absent means "not applicable") and nullable fields
  (`null` means "present but empty") collapse indistinguishably.
- A thrown `Error`, a `Set`, a `Map`, a function, a `BigInt`, or an
  `undefined`-dependent field in a command outcome would silently vanish or
  become `null` instead of failing.
- A future client and a future projection version need an explicit
  compatibility answer, not serializer luck.

The TUI consumes the in-process read models directly and is unaffected by
this contract.

## Decision

Define the browser wire as a versioned, plain-data projection of the
existing read models, converted by pure functions at the board-to-browser
boundary. No raw `BoardProjection` crosses the wire; the browser never sees
the capability registry, lane rules, or in-process class instances.

- Every envelope carries an explicit transport version and a `kind` tag
  (`board-snapshot`, `command-result`, `progress`). The snapshot also carries
  the projection version it was projected from.
- Special values are encoded, not serialized: an indefinite block is a tagged
  `indefinite` duration; session counts keep absent / `null` / `0` / `n` as
  four distinct wire states; mission work keeps live / unknown / stale /
  blocked / idle and coordinator evidence keeps live / stopped / unknown.
- Optional means omitted, nullable means `null`; the converter never emits an
  `undefined`-dependent field and the validators reject payloads where the
  two collapse.
- Action availability is server-owned: each action carries a typed kind,
  exact display text, and one of `enabled`, `ineligible` (lane/lifecycle), or
  `unavailable` (capability not integrated), with a reason for the two
  non-enabled states. The client renders; it does not evaluate.
- Command outcomes cross the wire as `{ status, error: { kind, message },
  durableEvidence, value? }`. The error is exactly two keys — never a stack
  trace. An outcome value that is not JSON-safe (thrown object, `Set`,
  `Map`, function, `Symbol`, `BigInt`, non-finite number, `undefined`
  dependency) rejects the whole result fail-closed instead of shipping a
  hole.
- Version mismatch fails closed: an unknown projection version is rejected
  before conversion, and a payload with an unsupported transport version is
  reported as an explicit `incompatible-client` state, distinct from a
  generic `invalid-payload` state. The exact HTTP response shape remains the
  transport mission's decision (ADR 0054).

| Option | Result |
|---|---|
| Versioned plain-data DTOs with explicit encodings | Accepted: the browser contract is testable without a server and every special value is representable. |
| Ship `BoardProjection` as-is | Rejected: `Infinity` becomes `null`, absent and `null` collapse, and thrown objects in outcomes cross silently. |
| JSON Schema validation with a generic schema framework | Rejected: the mission forbids a generic RPC/schema framework; hand-written validation of the three envelopes is smaller and keeps the contract in one module. |
| Stringly-typed special values (e.g. `"blockedForMs": "indefinite"`) | Rejected: mixes a tag into a number field; the tagged union keeps both shapes machine-checkable. |

## Mutation request envelope (TASK-2433)

The read direction (snapshot, progress) is client-pull only. One mutation
direction exists: a single host endpoint that dispatches a board action
through the shared guarded controller under the per-launch same-origin /
session / CSRF capability of ADR 0054. The request envelope is the fourth
validated shape in this contract.

- The top-level keys are exactly `missionId`, `kind`,
  `missionStatusAtRequest`, and `payload` (present only for
  `handoff:record`). Every other key is rejected: there is no key through
  which a client can supply an operation ID, a capability set, an agent, an
  environment, argv, a path, a version, or a "current" status. Validation is
  fail-closed — unknown keys, unknown kinds, and mistyped or out-of-range
  handoff fields are all rejections, never ignored fields.
- `kind` is one of the five card-advertised action kinds: `active:execute`,
  `draft:create`, `integrate:merge`, `handoff:record`, `review:submit`. The
  remaining board command kinds (`mission:intake`, `checkpoint:record`,
  `approve:review`, `review:act-on-findings`) are not card-advertised and are
  rejected as unsupported. Whether the action is currently enabled for that
  mission is decided by the server against a fresh projection, not by the
  client; a request for a kind the projection does not advertise as enabled
  is rejected before dispatch.
- `missionStatusAtRequest` is required and is the status the browser rendered
  on the card — the observed precondition the controller's authoritative
  stale guard compares against the status it reads immediately before
  dispatch. It is never interpreted as a claim about the current status.
- The `payload` key exists only for `handoff:record` and mirrors the domain
  handoff payload minus `expectedVersion`: `netEngineeringLines` (finite
  number ≥ 0), optional `predictedBucket` (`Small`/`Medium`/`Large` — the
  browser cannot send `Unknown`), `capturedAt` (string), optional
  `artifacts` (`{ kind: file|git-range|url, location, byteSize: finite
  number|null }`), and optional `reviewRounds` (finite integer ≥ 0). Identity
  kinds carrying a `payload` key are rejected.
- Operation identity is host-owned: the host generates the operation ID and
  the single-kind capability set itself, mirroring the TUI, and dispatches
  through the shared controller. No retry is performed server-side on any
  outcome.
- Status-code policy: 400 for schema violations — unknown keys, kinds that
  are not card-advertised, and mistyped or out-of-range handoff fields (zero
  dispatch), 403 from the security boundary (zero dispatch), 409 when the
  fresh projection does not advertise the action as enabled for the mission
  or the mission is absent from the projection (zero dispatch), and 200 for
  every dispatched outcome — including the wire statuses
  `conflict`, `failed`, and `cancelled`, which travel inside the
  `command-result` envelope rather than as new HTTP statuses. A conflict
  reuses the existing `failed` + `conflict` wire status so clients keep one
  parsing path; the structured expected/actual values let the client refetch
  and require a new confirmation.
- Every body the endpoint answers with is a `command-result` envelope
  (including the 400/403/409 rejections), so the error stays exactly
  `{ kind, message }` and no stack trace, filesystem path, or raw adapter
  error crosses the wire.

## Consequences

- The transport mission (TASK-2429) implements routes and SSE against this
  contract; the client can never drift from the server on special values or
  action states.
- New wire fields are additive within a transport version; changing an
  existing encoding, or adding a new projection version the converter does
  not know, requires a new transport version and an ADR-level note.
- The v1 wire snapshot deliberately omits the flow-metric series, cohorts,
  bottleneck narrative, and card review history/PR/labels. They are
  in-process TUI features with no special-value requirements; add them when
  the browser board actually renders them.
- The TUI keeps consuming in-process read models; this ADR changes nothing
  about lifecycle, ranking, liveness derivation, lane rules, or the
  capability registry.
- The request envelope's kind allowlist is the card-advertised set by
  construction: if card commands are ever extended beyond that set, the
  allowlist changes in the same mission as the extension, never by drift.
  The wire handoff payload is a projection of the domain handoff payload; a
  change to that domain shape moves the wire shape and this ADR together.
- The mutation endpoint is the only state-changing route on the host. Every
  other path and method keeps answering 405 behind the same security
  boundary; adding a second mutation surface requires a new ADR-level
  decision, not a route.

## Reconsideration triggers

- A second browser-facing representation (e.g. per-mission detail over the
  wire) that does not fit the three envelopes.
- A need for server→client push other than snapshot re-query, which would
  add an event envelope here rather than inventing one in transport.
- A browser feature that requires a flow-metric series or review history on
  the wire.

## References

- [TASK-2447](../../backlog/tasks/task-2447%20-%20Expose-complete-mission-card-facts-to-the-web-board.md) — amended: transport version 2 extends the card DTO with the server-owned `pullRequest` (nullable), `reviewApproved`, and `reviewHistory` facts that the v1 snapshot deliberately omitted, each validated fail-closed; v1 was dropped from the supported versions because no v1 browser client existed when the board shell was still in phase 1.

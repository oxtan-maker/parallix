# ADR 0055: Versioned JSON-safe web board transport contract

## Status

Accepted — 2026-08-28

Related: ADR 0054 (local web-board adapter), ADR 0051 (application
boundary), ADR 0048 (fail-closed harness), TASK-2430

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

## Reconsideration triggers

- A second browser-facing representation (e.g. per-mission detail over the
  wire) that does not fit the three envelopes.
- A need for server→client push other than snapshot re-query, which would
  add an event envelope here rather than inventing one in transport.
- A browser feature that requires a flow-metric series or review history on
  the wire.

# Mission: Define a versioned JSON-safe web board transport contract (task-2430)

## Goal
Define and test a versioned, JSON-safe board transport boundary that projects board state, mission activity, available actions, and typed command outcomes for a future browser client without adding HTTP routes or React components.

## Why Now
The local web-board adapter needs a stable browser contract before transport and UI work begin. Passing existing board objects through JSON would collapse `Infinity` to `null` and can erase the distinction between unknown, absent, and observed zero state.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: Contract-first dependency of TASK-2429's local web-board adapter work.
- Main drivers: JSON-safe DTO projection, explicit special-value encoding, version compatibility, server-owned action state, and pure conversion tests.

## Scope
- Define versioned snapshot, action, command-result, and progress DTOs containing only JSON objects, arrays, strings, booleans, finite numbers, and `null`.
- Add pure conversion and validation at the board-to-browser boundary, projecting existing `BoardProjection`, mission activity, action availability, and typed outcomes without moving lifecycle or lane-policy decisions into the client.
- Encode indefinite blocks, liveness states, optional-versus-nullable values, unsupported versions, and unavailable-versus-ineligible actions explicitly.
- Add focused unit tests for conversion, validation, and JSON serialization round trips.
- Record the durable contract rationale in an ADR if the implementation introduces a new externally consumed representation beyond ADR 0054's existing adapter decision.

## Out of Scope
- HTTP server, routes, streaming protocol, WebSocket/SSE transport, React components, and browser state management.
- Sending raw `BoardProjection` or capability-registry/lane-rule data to the browser.
- Changing attention ranking, lifecycle rules, `agentIsWorking`, mission state derivation, or action eligibility policy.
- A generic RPC, schema, or serialization framework.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: The board snapshot transport DTO has an explicit version and can be serialized with `JSON.stringify` and parsed with `JSON.parse` without emitting `Set`, `Map`, class instances, `Error`, functions, `BigInt`, `undefined`-dependent fields, or non-finite numbers.
- SC2: Conversion round-trip tests prove an application block duration of `Infinity` becomes a dedicated indefinite wire representation and never becomes wire `null` or an unknown duration.
- SC3: Conversion tests distinguish `runningSessions` states of unknown/unobserved, observed-none, and `0`, and preserve live, unconfirmed, stale, blocked, and idle mission-work liveness states.
- SC4: Each rendered action DTO carries a server-owned typed kind, exact display text, executable/enabled state, and an unavailable reason; tests distinguish an unavailable action from an ineligible action without client-side capability or lane-rule evaluation.
- SC5: Command-result and progress DTOs are versioned and validated; tests reject payloads containing stack traces, arbitrary thrown objects, or an unsupported snapshot/transport version, returning an explicit incompatible-client state for the version case.
- SC6: DTO conversion is pure and covered by focused unit tests; no HTTP server, network adapter, route, or UI component is added by this mission.
- SC7: `./scripts/verify-local.sh all` succeeds on the completed mission tree.

## Risks and Assumptions
- Assumes existing `BoardProjection` and action/liveness domain types expose enough semantic information to project without recomputing policy; stop if essential distinctions are unavailable.
- The contract must make every special value representable in JSON rather than relying on JavaScript serializer behavior.
- Version mismatch handling must fail closed while leaving the exact future HTTP response shape for transport work.
- ADR 0054 remains the governing local-web-board adapter context; add a narrow ADR only if a durable contract decision is not already covered there.

## Checkpoints
- CP 1: Map the existing board projection, mission activity, liveness, action availability, and typed-outcome sources to a minimal versioned wire representation; document application-fact-to-wire-representation mappings for `Infinity`, unknown/unobserved, observed-none, zero, omitted, null, unavailable, and ineligible states.
- CP 2: Implement pure DTO conversion and validation with focused unit tests covering serialization round trips, tagged unions, nullable/optional fields, version rejection, and safe command-result/progress errors.
- CP 3: Confirm no adapter/network/UI work entered the diff, run the required verifier, and complete the goal-check evidence table.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`.
- At least one evidence row for every success criterion, led by durable references Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.
- For special-value criteria, include an application-fact-to-wire-representation table and cite the conversion test file and exact test name that covers each encoded distinction.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with one of the accepted references above.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SC2 indefinite block encoding | `test/` conversion test path and its exact round-trip test name | PASS |
| SC7 verifier | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify HTTP transport, route, server, React, or browser-client code.
- Do not alter existing board lifecycle, attention ranking, liveness derivation, lane rules, capability registry, or action eligibility behavior.
- Do not introduce dependencies or a generic RPC/schema framework.
- Limit changes to the transport contract, its focused tests, and an ADR only if required by a new durable contract decision.

## Stop Rules
- Stop and request direction if projecting the required semantics needs changing existing lifecycle, ranking, liveness, lane-rule, capability-registry, or action-eligibility behavior.
- Stop and request direction if the future browser needs a transport protocol, route, server, or UI decision to make the DTO contract coherent.
- Stop and request direction if the existing domain model cannot distinguish a required state, rather than inventing a lossy representation.

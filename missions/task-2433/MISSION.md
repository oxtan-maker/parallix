# Mission: Add the same-origin guarded typed mutation endpoint for board actions (task-2433)

## Goal
Expose the shared guarded `BoardCommandController` over exactly one new local-only mutation endpoint, `POST /api/commands`, on the existing loopback-only web host (`src/interfaces/web/host.ts`). The endpoint reuses the existing per-launch Origin/session/CSRF boundary from `src/interfaces/web/security.ts` (no login, no reusable auth scheme), accepts only a strict allowlisted body of mission identifier + server-advertised action kind + optional observed status + optional typed handoff payload, generates the operation ID and capability set itself, rejects every action that the fresh authoritative projection does not currently advertise as `enabled` for that mission, dispatches through `BoardCommandController` (which carries TASK-2425's authoritative stale guard), and answers only with the safe `WebCommandResult` wire envelope. The browser cannot provide operation IDs, capabilities, current status, an agent, env overrides, argv, paths, or effect options.

## Why Now
All four dependencies are completed: TASK-2425 made the controller's stale guard authoritative, TASK-2429 routed `integrate:merge` through the guarded boundary, TASK-2430 defined the ADR 0055 wire contract (`src/interfaces/web/transport.ts`, including `WebCommandResult` and `toWebCommandResult`), and TASK-2432 shipped the live read transport. Today the host answers 405 to every state-changing method — the `onRequest` hook in `host.ts` already enforces Host/Origin/session/CSRF/content-length/content-type for non-read-only methods, but no mutation route exists behind it. The browser shell mission (TASK-2434) needs this endpoint to be first; until it lands the web board is read-only and the guarded controller is reachable only from the TUI.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is; TASK-2425, TASK-2429, TASK-2430, and TASK-2432 are all in `backlog/completed/`, so no precondition remains.
- Main drivers: one new POST route plus injected dispatcher port and advertised-action gate in `host.ts`; a new strict pure request validator and DTO in the transport contract module; production `BoardCommandController` wiring for `px web`; a unit suite for the validator and a real-socket integration suite covering the full negative matrix (malformed JSON, unknown field, unknown action, unavailable action, stale state, bad Origin/session/CSRF, effect failure) plus the happy path.

## Scope
- `src/interfaces/web/transport.ts`: a `WebCommandRequest` DTO and a pure fail-closed `validateWebCommandRequest` for the browser-to-host direction. Top-level keys are exactly `{ missionId, kind, missionStatusAtRequest, payload? }` — every other key is rejected. `kind` is one of the five card-advertised action kinds (`active:execute`, `draft:create`, `integrate:merge`, `handoff:record`, `review:submit`); `mission:intake`, `checkpoint:record`, `approve:review`, and `review:act-on-findings` are not card-advertised and are rejected as unsupported. `missionStatusAtRequest` is required (the status the browser rendered on the card; it is the observed precondition TASK-2425's guard compares, never a "current" value). `payload` is present only for `handoff:record` and must match the domain handoff payload shape minus `expectedVersion`: `netEngineeringLines` (finite number ≥ 0), optional `predictedBucket` (`Small`/`Medium`/`Large`), `capturedAt` (string), optional `artifacts` (array of `{ kind: 'file'|'git-range'|'url', location: string, byteSize: finite number|null }`), optional `reviewRounds` (finite integer ≥ 0). Identity-only kinds carrying a `payload` key are rejected.
- `src/interfaces/web/host.ts`: register `POST /api/commands` (it outranks the existing `/*` catch-all, which keeps answering 405 with the `allow` header for every other path/method). Add a narrow injected dispatcher port (e.g. `commandDispatcher?: BoardCommandDispatcher` or an equivalent single-method closure) to `WebHostOptions`. Before dispatch, build the fresh projection through the existing `buildProjection` port, locate the mission's card, and require the matching action's server-owned `state === 'enabled'`; mission absent from the projection or action not enabled → HTTP 409 with a `WebCommandResult` body and zero dispatch. The host generates `operationId` (`crypto.randomUUID()`) and the capability set (single-kind set, mirroring the TUI) and dispatches via the controller. Every response body is a `WebCommandResult` produced by `toWebCommandResult`: 400 schema violations, 403 from the existing security hook, 409 advertised-gate rejections, 200 for dispatched outcomes (including `conflict`, `failed`, `cancelled`). No server-side retry on any outcome.
- `src/interfaces/cli/web.ts` + `src/composition/create-cli.ts`: wire the production `BoardCommandController` into `px web` from the same production dependencies the TUI uses (reuse the existing composition helper in `src/composition/board-projection.ts` that builds controllers from `executePorts`, mission services, current-work port, and `missionStore`); the web interface layer itself constructs no read or effect adapters.
- Tests: new unit file `test/web-command-request.test.ts` (pure validator: unknown top-level key, unknown/unsupported kind, `payload` on identity-only kind, malformed handoff fields, well-formed accept) and new integration file `test/task-2433-web-mutation.integration.test.ts` (real loopback socket, same conventions as `test/web-host.integration.test.ts`, with an injected dispatcher spy and injected projection builder covering: happy path with exactly one dispatch and host-generated operation ID, malformed JSON, unknown field, unknown action kind, action not currently enabled, mission absent, stale status → wire `conflict` with exactly one attempt, wrong Origin/session/CSRF → 403, effect failure → no stack/path in body, GET/SSE/asset routes and the 405 catch-all unchanged).
- Docs: extend ADR 0055 with the request-envelope decision (which keys exist, which kinds are supported, host-generated identity, observed-status precondition, status-code policy).

## Out of Scope
- Any login, account, bearer token, or reusable authentication scheme; the per-launch same-origin/session/CSRF capability stays the whole boundary.
- Changes to `src/interfaces/web/security.ts` policy, loopback bind literals, CSP/protection headers, or the existing double-submit scheme (reused, not renegotiated).
- Any second mutation route, generic RPC `{ method, args }` surface, WebSocket, or bidirectional channel.
- Any endpoint or field for arbitrary `px` commands, environment overrides, file reads/writes, SQL, Git refs, repository switching, or agent selection (`agent` is not a wire key; `WORKFLOW_AGENT`-style overrides from the mockup are forbidden).
- Optimistic server-side projection mutation after dispatch; truth is re-established by refetching the snapshot.
- Changes to lifecycle transition policy, WIP limits, the capability registries (`INTEGRATED_CAPABILITIES`/`UNAVAILABLE_CAPABILITIES`), or the TASK-2425 stale-guard semantics in `src/application/controller/board-controller.ts`.
- The React browser shell and client-side state (TASK-2434/TASK-2435); this mission delivers the endpoint and its contract, not a consumer.
- New npm runtime dependencies.
- Changes to `WEB_TRANSPORT_VERSION` or the existing snapshot/result/progress envelope shapes.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1 (method/path): `POST /api/commands` is the only mutation route. `PUT`, `DELETE`, `PATCH`, and `OPTIONS` to any path, and `POST` to any path other than `/api/commands`, still return 405 with the `allow` header; `GET /api/board`, `GET /api/events`, `/`, and manifest-listed assets behave exactly as before (existing assertions in `test/web-host.integration.test.ts` pass unmodified).
- SC2 (strict schema): a body with any unknown top-level key (including `operationId`, `capabilities`, `agent`, `command`, `args`, `env`, `path`, `file`, `sql`, `ref`, `currentStatus`), a kind outside the five card-advertised kinds (including `mission:intake` and `checkpoint:record`), a `payload` key on an identity-only kind, or a handoff payload with a missing/mistyped/out-of-range field is rejected with HTTP 400 and exactly zero dispatcher calls (asserted by spy call count, not by error-string matching).
- SC3 (host-owned identity): for an accepted POST, the dispatched `BoardCommandRequest` carries a host-generated `operationId` (asserted distinct from any client-supplied candidate and non-empty) and a capability set of exactly one element equal to the requested kind; the wire schema has no key through which a client can supply either.
- SC4 (advertised gate): a hand-crafted request whose kind the fresh authoritative projection does not advertise as `enabled` for that mission — ineligible by lane, `unavailable` capability, or mission absent from the projection — is rejected with HTTP 409 carrying a `WebCommandResult` body and exactly zero dispatcher calls.
- SC5 (authoritative stale guard): when the mission's status changes after the snapshot the client read and before dispatch, the response is a `WebCommandResult` with status `failed` and `error.kind === 'conflict'`, the response carries the expected and actual status values from the TASK-2425 `staleConflict` outcome, and the dispatcher was called exactly once (no server-side retry, no auto-re-dispatch).
- SC6 (safe wire outcomes): every response body from the endpoint passes `validateWebCommandResult`; for a use case that fails with an `Error` whose message embeds a stack trace and an absolute filesystem path, the response body contains neither the stack text nor the path (the error is exactly `{ kind, message }` per the transport contract).
- SC7 (happy path): a valid POST for an `enabled` action returns HTTP 200 with a `WebCommandResult` of status `completed`, exactly one `BoardCommandController` dispatch call, and one progress event on the SSE stream carrying the same `operationId` as the response.
- SC8 (no bypass): `src/interfaces/web/**` contains no `exec`, `spawn`, shell string, or `px`-invocation path, and no route or wire field selects an agent, environment, argv, path, SQL, Git ref, or repository; the reviewer confirms there is no browser-to-shell or browser-to-adapter bypass path through the new route.
- SC9 (gates): `./scripts/verify-local.sh all` passes on the final tree, and the new unit tests meet the 500 ms per-test authoring target under `npm test -- --unit-test-headroom`.

## Risks and Assumptions
- Assumes the fresh-projection advertised check and the controller's own authoritative store read are sufficient layers: the TOCTOU window between the interface check and the controller guard is closed by TASK-2425's read-immediately-before-dispatch, so no new lock or cache is added. Stop if the implementer finds a window that requires new concurrency machinery.
- Assumes the snapshot's per-card `actions` (server-owned `enabled`/`ineligible`/`unavailable`) is the complete definition of "currently advertised"; if card commands are ever extended beyond the five `BOARD_COMMAND_KINDS` entries, the endpoint's kind allowlist must change in the same mission as that extension, not drift.
- Assumes `missionStatusAtRequest` can be made required because every card in the snapshot carries its `status`; if a future card shape can render without a status, the contract must be revisited before the shell ships.
- Risk: making `POST /api/commands` outrank the `/*` catch-all could accidentally widen the 405 surface; mitigated by SC1's unmodified-pass requirement for the existing integration assertions.
- Risk: the validator duplicates part of the domain payload shape; if `BoardCommandPayload`'s handoff variant changes, both must move together — the unit suite pins the wire shape, and ADR 0055 records the mapping.
- The conflict response intentionally reuses the existing `failed` + `conflict` wire status rather than inventing a new HTTP status, so clients keep one parsing path; a follow-up may map conflict to 409 only if the shell's needs prove it.

## Checkpoints
- CP 1: Wire request contract. Add `WebCommandRequest` and the pure fail-closed `validateWebCommandRequest` to `src/interfaces/web/transport.ts` per the Scope key set, plus the unit file `test/web-command-request.test.ts` covering unknown top-level key, each unsupported kind, `payload` on an identity-only kind, malformed/out-of-range handoff fields, and one well-formed accept per supported kind. Extend ADR 0055 with the request-envelope decision and run `./scripts/verify-local.sh docs` plus the unit tests.
- CP 2: Endpoint and wiring. Add `POST /api/commands` with the injected dispatcher port and the fresh-projection advertised gate to `src/interfaces/web/host.ts`; wire the production `BoardCommandController` through `src/interfaces/cli/web.ts` and the `px web` closure in `src/composition/create-cli.ts`; add `test/task-2433-web-mutation.integration.test.ts` with the full negative matrix (malformed JSON, unknown field, unknown action, action not enabled, mission absent, wrong Origin/session/CSRF, stale state, effect failure) and the happy path asserting one dispatch, host-generated operation ID, and the SSE progress event.
- CP 3: Harden and close. Run the full gate set and the unit headroom check; verify SC1–SC8 line by line; confirm no `exec`/`spawn`/shell path exists in `src/interfaces/web/**`; confirm the reviewer bypass question (SC8); keep ADR 0055 and the transport module consistent with the final implementation.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/web-command-request.test.ts` ``, `` `npm test -- --unit-test-headroom` ``, `` `./scripts/verify-local.sh all` ``, or `` `./scripts/verify-local.sh docs` ``
  2. **Test names** — e.g., `"rejects an action not currently enabled for the mission with 409 and zero dispatch"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2433-web-mutation.integration.test.ts`, `test/web-command-request.test.ts` (must be existing test files)
  4. **ADR references** — e.g., `ADR 0055` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Lead with the durable forms above for this mission: the new test files (`test/web-command-request.test.ts`, `test/task-2433-web-mutation.integration.test.ts`), the named tests they contain, `ADR 0055`, and the backticked gate commands. For example, SC4 evidence is the file path plus the 409/zero-dispatch test name — not a description of what the test "should" do.
- Raw `stat`/`ls` output or generic prose is not sufficient evidence on its own: a checkpoint that only pastes directory listings or says "tests pass" without one of the accepted references above (a test name, test file path, ADR reference, or exact repo command) will be rejected as weak evidence. Pair any shell output with one of the accepted references.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Strict validator rejects unknown top-level keys | `test/web-command-request.test.ts`, `"rejects an unknown top-level key"` | PASS |
| Advertised gate rejects non-enabled actions with zero dispatch | `test/task-2433-web-mutation.integration.test.ts`, `"rejects an action not currently enabled for the mission with 409 and zero dispatch"` | PASS |
| Request envelope recorded in the transport ADR | `ADR 0055` | PASS |
| Full gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/interfaces/web/security.ts` — policy, loopback literals, session/CSRF scheme: reuse only, no changes.
- `src/domain/**` — no domain shape changes; the wire handoff payload maps to existing domain types.
- `src/adapters/**` — no new adapters; the web interface layer constructs no read or effect adapters.
- `src/application/controller/board-controller.ts` and the capability registries in `src/application/controller/board-command.ts` — the controller is consumed as-is; no guard, policy, or retry semantics changes.
- Existing read routes (`GET /api/board`, `GET /api/events`), asset serving, and their tests' behavioral assertions — unchanged.
- `docs/adr/` — only the ADR 0055 extension; no new ADR number and no renumbering.
- No new npm dependencies in either `dependencies` or `devDependencies`.

## Stop Rules
- Stop if satisfying any success criterion requires changing the session/CSRF/Origin policy, the loopback bind literals, or the CSP/protection headers — that is an ADR 0054 reconsideration trigger, file a follow-up task instead.
- Stop if the advertised gate cannot be built without moving lane-eligibility or capability-registry decisions from the application layer into `src/interfaces/web/**` (ADR 0051 violation).
- Stop if the endpoint would need any wire key beyond `missionId`, `kind`, `missionStatusAtRequest`, and the handoff `payload` — refine the contract via a new backlog task, do not widen the schema silently.
- Stop if any test requires non-loopback network, a real agent launch, or a real Forgejo interaction — use injected ports and spies.
- Stop and split if the mission's net engineering lines exceed roughly 900 (about double the top of the Large bucket) — the negative-matrix tests or the handoff payload support should become a follow-up.

# CP 2 — Endpoint and wiring

## Summary

Added the single guarded mutation route `POST /api/commands` and wired the production controller into `px web`.

- `src/interfaces/web/host.ts`:
  - New exported route `WEB_COMMANDS_PATH = '/api/commands'`, registered ahead of the 405 catch-all (which keeps answering 405 + `allow: GET, HEAD` for every other path/method).
  - New `WebHostOptions.commandDispatcher?: () => BoardCommandDispatcher | null` — a narrow injected port (supplier because composition resolves the dispatcher after the host exists; `null` keeps the host read-only with a 503 `unavailable` result).
  - Request flow: strict `validateWebCommandRequest` (400, zero dispatch) → fresh projection through the existing `buildProjection` port (build failure → 503 `unavailable`, mirroring the snapshot route) → gate on the wire snapshot's server-owned card action state; mission absent or action not `enabled` → 409 `conflict`, zero dispatch. Gating on `toWebBoardSnapshot` output reuses the single definition of "currently advertised" (unavailable capability outranks domain eligibility).
  - The host generates `operationId = crypto.randomUUID()` and the single-kind capability set (mirroring the TUI) and dispatches through the port. Every dispatched outcome — completed, conflict, failed, cancelled — answers 200 inside the `WebCommandResult` envelope; no server-side retry.
  - Every body the endpoint answers with is a `WebCommandResult`: 400 (schema + malformed JSON via a new Fastify error handler that never echoes parser input), 403 (security hook rejections, `capability` error kind), 409 (advertised gate), 503 (port not wired / projection build failure), 200 (dispatched outcomes). Transport size/type limits (411/413/415) keep their existing status and empty body.
- `src/interfaces/cli/web.ts`: `WebBoardSource` gains optional `commandDispatcher?: BoardCommandDispatcher | null`; `runWebCommand` passes it to the host lazily. Existing `web-host.integration.test.ts` stays byte-identical.
- `src/composition/create-cli.ts`: `px web` now returns `commandDispatcher: capabilities.commandController` — the exact `BoardCommandController` instance composition builds from the production execute ports, Mission services, current-work port, and Mission store (the same instance the TUI dispatches through). Its progress sink is already this host's SSE sink. The web interface layer constructs no read or effect adapters.
- `test/task-2433-web-mutation.integration.test.ts`: 12 real-loopback-socket tests with an injected dispatcher spy and injected projection builder: happy path (one dispatch, host-generated UUID distinct from a client candidate, exactly-one-element capability set, payload mapped minus `expectedVersion`, one SSE progress event carrying the dispatched operation ID), malformed JSON, unknown field, non-card-advertised kinds, action not enabled (409), unavailable capability (409), mission absent (409), stale state (wire `failed`/`conflict` with expected+actual, exactly one attempt), wrong Origin/session/CSRF (403, zero dispatch), effect failure (no stack/path in body), 405 catch-all + read routes unchanged, read-only host 503.
- `src/interfaces/web/transport.ts`: added `isInvalidWebCommandRequest` type guard — the test project typechecks without `strictNullChecks`, where boolean-literal discriminants do not narrow; src callers use the guard instead of narrowing on `ok`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Happy path: one dispatch, host-generated operation ID, SSE progress event | `test/task-2433-web-mutation.integration.test.ts`, "an enabled action dispatches exactly once with a host-generated operation ID and a matching SSE progress event" | PASS |
| Malformed JSON → 400, zero dispatch | `test/task-2433-web-mutation.integration.test.ts`, "a malformed JSON body is 400 with a command-result body and zero dispatch" | PASS |
| Unknown field → 400, zero dispatch | `test/task-2433-web-mutation.integration.test.ts`, "an unknown top-level field is 400 with zero dispatch" | PASS |
| Unknown/unsupported action kind → 400, zero dispatch | `test/task-2433-web-mutation.integration.test.ts`, "a kind that is not card-advertised is 400 with zero dispatch" | PASS |
| Action not currently enabled → 409, zero dispatch | `test/task-2433-web-mutation.integration.test.ts`, "rejects an action not currently enabled for the mission with 409 and zero dispatch" | PASS |
| Unavailable capability → 409, zero dispatch | `test/task-2433-web-mutation.integration.test.ts`, "rejects an unavailable capability with 409 even when the domain availability is enabled" | PASS |
| Mission absent → 409, zero dispatch | `test/task-2433-web-mutation.integration.test.ts`, "rejects a mission absent from the projection with 409 and zero dispatch" | PASS |
| Stale state → wire conflict, exactly one attempt | `test/task-2433-web-mutation.integration.test.ts`, "a stale status after the snapshot is a wire conflict with exactly one attempt" | PASS |
| Wrong Origin/session/CSRF → 403, zero dispatch | `test/task-2433-web-mutation.integration.test.ts`, "a wrong Origin, session, or CSRF is 403 with a command-result body and zero dispatch" | PASS |
| Effect failure → no stack/path in body | `test/task-2433-web-mutation.integration.test.ts`, "an effect failure never sends a stack trace or filesystem path" | PASS |
| 405 catch-all + read routes unchanged | `test/task-2433-web-mutation.integration.test.ts`, "the 405 catch-all and the read routes are unchanged around the new path"; `test/web-host.integration.test.ts` (27/27 pass unmodified) | PASS |
| Production controller wired into `px web` | `test/web-package-smoke.integration.test.ts` (3/3 pass), `test/web-host.integration.test.ts` ("web cli: createBoardSource gets the host sink, its build port serves, close runs on stop"); wiring in `src/composition/create-cli.ts` (`createBoardSource` returns `capabilities.commandController`) | PASS |
| Static analysis gate passes | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: CP 3 — run `./scripts/verify-local.sh all` and `npm test -- --unit-test-headroom`, verify SC1–SC8 line by line (including the `src/interfaces/web/**` exec/spawn/shell/px-invocation scan), confirm the ADR 0055 extension matches the final implementation, and close out.

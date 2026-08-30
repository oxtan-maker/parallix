# CP 1 — Wire request contract

## Summary

Added the browser-to-host mutation envelope to the transport contract module and pinned its fail-closed shape with a pure unit suite.

- `src/interfaces/web/transport.ts`:
  - `WebCommandRequest` DTO: exactly `{ missionId, kind, missionStatusAtRequest, payload? }`. `payload` is a `WebHandoffPayload` mirroring the domain handoff payload minus `expectedVersion` (`netEngineeringLines` finite ≥ 0, optional `predictedBucket` Small/Medium/Large, `capturedAt` string, optional `artifacts` of `{ kind: file|git-range|url, location, byteSize: finite number|null }`, optional `reviewRounds` finite integer ≥ 0).
  - `WebCommandRequestKind`: the five card-advertised kinds (`active:execute`, `draft:create`, `integrate:merge`, `handoff:record`, `review:submit`). The four non-card-advertised kinds are rejected as unsupported.
  - `validateWebCommandRequest`: pure, fail-closed. Rejects every unknown top-level key (including `operationId`, `capabilities`, `agent`, `command`, `args`, `env`, `path`, `file`, `sql`, `ref`, `currentStatus`), every non-card-advertised kind, a `payload` key on any identity-only kind, and every missing/mistyped/out-of-range handoff field. Accepts one well-formed request per supported kind.
- `test/web-command-request.test.ts`: 9 pure unit tests covering the full CP-1 matrix.
- `docs/adr/0055-web-board-transport-contract.md`: new "Mutation request envelope (TASK-2433)" section recording the key set, kind allowlist, host-generated identity, observed-status precondition, status-code policy (400/403/409/200), and the failure-to-add-second-route consequence; consequences extended for allowlist co-evolution and handoff payload co-evolution.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `WebCommandRequest` DTO with exactly the four allowed top-level keys | `src/interfaces/web/transport.ts` (`WebCommandRequest`), `test/web-command-request.test.ts` | PASS |
| Unknown top-level key rejected (incl. `operationId`, `capabilities`, `agent`, `command`, `args`, `env`, `path`, `file`, `sql`, `ref`, `currentStatus`) | `test/web-command-request.test.ts`, "rejects every unknown top-level key, including the forbidden client-side controls" | PASS |
| Unsupported kinds rejected (`mission:intake`, `checkpoint:record`, `approve:review`, `review:act-on-findings`, unknown) | `test/web-command-request.test.ts`, "rejects each kind that is not card-advertised, and any unknown kind" | PASS |
| `payload` on an identity-only kind rejected | `test/web-command-request.test.ts`, "rejects a payload key on every identity-only kind" | PASS |
| Malformed/out-of-range handoff fields rejected (22 field cases) | `test/web-command-request.test.ts`, "rejects handoff payloads with missing, mistyped, or out-of-range fields" | PASS |
| Well-formed accept per supported kind (5 kinds) | `test/web-command-request.test.ts`, "accepts a well-formed identity-only request for each of the five card-advertised kinds", "accepts a well-formed handoff:record request with the full payload" | PASS |
| Request-envelope decision recorded in the transport ADR | `ADR 0055` ("Mutation request envelope (TASK-2433)" section) | PASS |
| Docs gate passes | `./scripts/verify-local.sh docs` | PASS |
| Unit tests green | `npm test -- test/web-command-request.test.ts test/web-transport.test.ts` | PASS |

Next action: CP 2 — add `POST /api/commands` with the injected dispatcher port and fresh-projection advertised gate to `src/interfaces/web/host.ts`, wire the production controller through `src/interfaces/cli/web.ts` + `src/composition/create-cli.ts`, and add `test/task-2433-web-mutation.integration.test.ts` with the full negative matrix and happy path.

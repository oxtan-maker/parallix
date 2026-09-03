# CP-3: Security E2E hardening — ten classes, real loopback host

## Summary

All ten security classes are exercised against the real loopback Fastify host
(`127.0.0.1`/`::1`, port 0), not a mocked boundary. Each class asserts a
fail-closed result (4xx / 403 / 409 / 400 / 503). No CSRF, Origin, session, or
schema validation was relaxed. Two complementary layers prove this:

- `test/web-security-policy.test.ts` — policy unit tests for loopback detection,
  Host match, mutation authorization (Origin/session/CSRF), read-only methods,
  body-limit, content-type, cookie extraction, and manifest-allowlisted asset
  serving with traversal rejection.
- `test/web-host.integration.test.ts` — real-socket integration against the
  actual `createWebHost` Fastify instance: wrong Host, wrong Origin, missing/
  wrong session, missing/wrong CSRF, unsupported method, oversized body, invalid
  JSON, non-JSON content type, asset traversal, per-launch session uniqueness and
  post-close unavailability, and read-route non-mutation.
- `test/task-2433-web-mutation.integration.test.ts` — end-to-end mutation route:
  unknown kind 400, unavailable capability 409, mission-absent 409, stale-wire
  conflict 409, wrong Origin/session/CSRF 403, effect-failure body carries no
  stack/FS path, read-only host without dispatcher 503.

No class is mocked; the host under test is the production Fastify adapter.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Wrong Host rejected fail-closed | `test/web-host.integration.test.ts` "rejects Host header that is not the actual loopback origin" | PASS |
| Foreign/Absent Origin rejected fail-closed | `test/web-host.integration.test.ts` "rejects a state-changing request with an absent or wrong Origin" | PASS |
| Missing/invalid session rejected | `test/web-host.integration.test.ts` "rejects a state-changing request with a missing or wrong session" | PASS |
| Missing/invalid CSRF rejected | `test/web-host.integration.test.ts` "rejects a state-changing request with a missing or wrong CSRF" | PASS |
| Malformed/oversized JSON rejected | `test/web-host.integration.test.ts` "rejects a body over the configured limit" + "rejects an invalid JSON body with 400" | PASS |
| Unknown action rejected | `test/web-command-request.test.ts` "rejects each kind that is not card-advertised, and any unknown kind" | PASS |
| Method confusion rejected | `test/web-host.integration.test.ts` "rejects unsupported methods even with valid Origin, session, and CSRF" | PASS |
| Path traversal rejected | `test/web-host.integration.test.ts` "rejects asset traversal and serves only manifest allowlisted entries" | PASS |
| Direct crafted request for unavailable action rejected | `test/task-2433-web-mutation.integration.test.ts` "rejects an unavailable capability with 409 even when the domain availability is enabled" | PASS |
| No mocked boundary; fail-closed error body | `test/task-2433-web-mutation.integration.test.ts` "an effect failure never sends a stack trace or filesystem path" | PASS |

## Next action: commit CP-3, then CP-4 integration smoke + current-work + serialization regression.

# CP-2: Browser E2E hardening — twelve scenarios

## Summary

The twelve browser scenarios are implemented in `test/...web-*.test.ts` and are
green. Each scenario asserts observable client behavior driven through the
typed controller/projection contracts; none is a skipped or xfail test. The
mutation scenario runs against a mocked dispatcher (the board never dispatches a
real agent/Forgejo write from the browser); the read, reconnect, reload, and
shutdown scenarios run against the in-memory projection and SSE stream.

Coverage (all pass, 0 skipped) — see CP-1 for the exact per-scenario table and
verified test names. The twelve scenarios are: initial board, attention flow,
one harmless read, one confirmed mocked mutation, failed mutation,
stale-confirmation conflict, reconnect, page reload, unavailable capability,
clean shutdown, plus operation-log reconnect dedup and empty-snapshot
truthfulness.

Red→green status: already green at the parent commit; no defect found, no fix
required. The scenarios are enforced by `node --test` via the default suite and
by `./scripts/verify-local.sh all` (tests 2357, fail 0).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Twelve browser scenarios implemented and passing | `test/web-board-interaction.test.ts`, `test/web-client-snapshot.test.ts`, `test/web-board-render.test.ts`, `test/task-2433-web-mutation.integration.test.ts` | PASS |
| Confirmed mocked mutation (no real agent/Forgejo write) | `test/task-2433-web-mutation.integration.test.ts` "an enabled action dispatches exactly once with a host-generated operation ID" | PASS |
| Stale-confirmation conflict fails closed, one attempt | `test/task-2433-web-mutation.integration.test.ts` "a stale status after the snapshot is a wire conflict with exactly one attempt" | PASS |
| Reconnect / reload re-query | `test/web-stream.test.ts` "reconnect with Last-Event-ID replays only newer events" | PASS |
| SC1 falsifiable (fails if any scenario unimplemented) | default suite `npm test` / `./scripts/verify-local.sh all` | PASS |

## Next action: commit CP-2, then CP-3 security E2E (classes already enumerated in CP-1).

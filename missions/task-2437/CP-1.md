# CP-1: Adversarial scope map — the web board as a hostile reviewer

## Summary

Ran the ADR 0054 web board slice as a hostile reviewer and locked every
scenario and security class into an existing, non-skipped test before any fix.
The web board (tasks 2432–2436) is already wired and the full suite is green
(2357 tests, 0 failed, 0 skipped). This checkpoint records the adversarial
map and confirms no untested defect exists at the parent commit.

Live hostile run performed: `node build/px.mjs web --host 127.0.0.1` binds
`http://127.0.0.1:<ephemeral>` (loopback only), serves the shell with the full
protection header set (CSP `script-src 'self'`, per-launch `px_session`
`HttpOnly` cookie, `X-Frame-Options: DENY`), and the served `index.html` has
zero `http(s)://` references (no CDN) and no inline executable script.

### Twelve browser scenarios → locked test

| Scenario | Evidence test | Status |
|---|---|---|
| Initial board | `test/web-board-render.test.ts` "a populated snapshot renders repository identity and all six received stages in received order" | PASS |
| Attention flow | `test/web-board-interaction.test.ts` "board drag dispatches the projected target action and rejects other targets" | PASS |
| One harmless read | `test/web-client-snapshot.test.ts` "a validated snapshot response becomes the ready state" | PASS |
| Confirmed mocked mutation | `test/task-2433-web-mutation.integration.test.ts` "an enabled action dispatches exactly once with a host-generated operation ID" | PASS |
| Failed mutation | `test/web-board-interaction.test.ts` "board failure leaves the card in its received lane and restores initiating focus" | PASS |
| Stale-confirmation conflict | `test/task-2433-web-mutation.integration.test.ts` "a stale status after the snapshot is a wire conflict with exactly one attempt" | PASS |
| Reconnect | `test/web-host.integration.test.ts` "SSE reconnect with Last-Event-ID replays only newer events" | PASS |
| Page reload (re-query after invalidation) | `test/web-client-snapshot.test.ts` "a non-ok snapshot response becomes an explicit request-failure state" + `test/web-stream.test.ts` "reconnect with Last-Event-ID replays only newer events" | PASS |
| Unavailable capability | `test/task-2433-web-mutation.integration.test.ts` "rejects an unavailable capability with 409 even when the domain availability is enabled" | PASS |
| Clean shutdown | `test/web-host.integration.test.ts` "a disconnect removes that client, and close() unsubscribes the projection" | PASS |
| Operation-log reconnect dedup | `test/web-board-render.test.ts` "operation progress deduplicates reconnects and evicts oldest entries" | PASS |
| Empty-snapshot truthfulness | `test/web-board-render.test.ts` "an empty snapshot states each region is empty and never shows a zero metric as a fact" | PASS |

### Ten security classes → locked test (real loopback host, no mocked boundary)

| Class | Evidence test | Status |
|---|---|---|
| Wrong `Host` | `test/web-host.integration.test.ts` "rejects Host header that is not the actual loopback origin"; `test/web-security-policy.test.ts` "expected Host header matches only actual loopback host and bound port" | PASS |
| Foreign `Origin` | `test/web-host.integration.test.ts` "rejects a state-changing request with an absent or wrong Origin" | PASS |
| Missing/invalid session | `test/web-host.integration.test.ts` "rejects a state-changing request with a missing or wrong session"; `test/web-security-policy.test.ts` "mutation authorization rejects an absent or wrong session cookie" | PASS |
| Missing/invalid CSRF | `test/web-host.integration.test.ts` "rejects a state-changing request with a missing or wrong CSRF"; `test/web-security-policy.test.ts` "mutation authorization rejects an absent or wrong CSRF header" | PASS |
| Malformed/oversized JSON | `test/web-host.integration.test.ts` "rejects a body over the configured limit" + "rejects an invalid JSON body with 400" | PASS |
| Unknown action | `test/web-command-request.test.ts` "rejects each kind that is not card-advertised, and any unknown kind" | PASS |
| Method confusion | `test/web-host.integration.test.ts` "rejects unsupported methods even with valid Origin, session, and CSRF"; `test/web-security-policy.test.ts` "only GET and HEAD are read-only methods" | PASS |
| Path traversal | `test/web-host.integration.test.ts` "rejects asset traversal and serves only manifest allowlisted entries"; `test/web-security-policy.test.ts` "asset path resolution rejects traversal and non-allowlisted paths" | PASS |
| Direct crafted request for unavailable action | `test/task-2433-web-mutation.integration.test.ts` "rejects an unavailable capability with 409 even when the domain availability is enabled" | PASS |
| Fail-closed error body (no path/stack leak) | `test/task-2433-web-mutation.integration.test.ts` "an effect failure never sends a stack trace or filesystem path" | PASS |

No defensive boundary was relaxed and no sleep/retry/timeouts were added.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Twelve browser scenarios locked into non-skipped tests | `test/web-board-interaction.test.ts`, `test/web-client-snapshot.test.ts`, `test/task-2433-web-mutation.integration.test.ts` | PASS |
| Ten security classes exercised against real loopback host | `test/web-host.integration.test.ts`, `test/web-security-policy.test.ts` | PASS |
| Full suite green, no skipped tests | `./scripts/verify-local.sh all` → tests 2357, pass 2357, fail 0, skipped 0 | PASS |
| Live `px web` binds loopback only, serves with protection headers, zero CDN refs | `node build/px.mjs web --host 127.0.0.1`, served HTML `grep -c http(s)://` = 0 | PASS |

## Next action: commit CP-1, then verify SC2/SC3 coverage gap-free in CP-3 (security classes already covered above).

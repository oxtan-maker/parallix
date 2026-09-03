# CP-4: Integration smoke + current-work + serialization regression

## Summary

Proved server projection and typed controller wiring end to end against a
disposable in-memory repository, without touching real Forgejo or a paid/real
agent; verified current-work semantics regression; and verified serialization of
indefinite block duration and unknown-versus-zero liveness in a real HTTP
snapshot (WEB_TRANSPORT_VERSION 2 wire states).

- **Disposable-repository integration smoke (SC3):** `test/web-host.integration.test.ts`
  (31 tests) builds the real Fastify host, injects a disposable board projection
  fixture (`test/fixtures/board-projection.js`), and drives the snapshot, SSE,
  mutation, and asset routes over a loopback socket. "a failing projection build
  surfaces an error, never an empty board" proves fail-closed projection wiring;
  "snapshot route returns a valid versioned board snapshot" proves the typed
  controller/snapshot path.
- **Current-work semantics (SC4):** `test/current-work-publication.test.ts`
  (16 tests) + `test/current-work-reconciliation.test.ts` (2 tests). Live
  authoritative work animates; coordinator-only evidence never becomes a
  running-agent claim; stale/unconfirmed work stays distinct.
- **Serialization regression (SC5):** `test/web-transport.test.ts` (22 tests),
  WEB_TRANSPORT_VERSION 2 wire states. "indefinite agent block projects to a
  dedicated indefinite wire representation, never null" asserts indefinite block
  duration survives a JSON snapshot; "running sessions distinguish unobserved,
  observed-none, and a positive count" and "mission work activity preserves live,
  unconfirmed, stale, blocked, and idle liveness" assert unknown-versus-zero
  liveness.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Disposable-repository integration smoke, fail-closed projection | `test/web-host.integration.test.ts` "a failing projection build surfaces an error, never an empty board" | PASS |
| Current-work: live work animates, coordinator-only not a running-agent claim | `test/current-work-publication.test.ts`, `test/current-work-reconciliation.test.ts` | PASS |
| Serialization: indefinite block never wire-null | `test/web-transport.test.ts` "indefinite agent block projects to a dedicated indefinite wire representation, never null" | PASS |
| Serialization: unknown-vs-zero liveness | `test/web-transport.test.ts` "running sessions distinguish unobserved, observed-none, and a positive count" | PASS |

## Next action: commit CP-4, then CP-5 high-volume SSE/progress/reconnect bounded-buffer tests.

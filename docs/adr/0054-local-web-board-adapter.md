# ADR 0054: React web board with a Fastify local adapter

## Status

Accepted — 2026-08-28

Related: ADR 0044 (distribution), ADR 0048 (fail-closed harness), ADR 0051
(application boundary), ADR 0053 (persistence authority)

## Context

The supplied board design is an interactive React prototype with lanes,
attention ranking, drag/drop commands, flow metrics, and a live command log.
The repository already uses React through Ink and exposes UI-neutral board
projections and application commands. A browser client should reuse those
contracts, not Ink components or CLI subprocess output.

## Decision drivers and evidence

ADR 0051 requires interfaces to submit commands and read projections; ADR 0048
requires fail-closed evidence; ADR 0053 retains one writer. ADR 0044 permits
audited third-party code in the canonical bundle. The prototype demonstrates
React interaction, while the existing Node bundle supplies the local host.

## Decision

Build a client-rendered React and React DOM single-page board. Use Vite for
development and browser builds; do not add server rendering, a client router,
or another browser state framework without a demonstrated need.

Run Fastify inside the canonical Node process as an inbound adapter. It serves
assets, returns projections, validates JSON-Schema command requests, and
invokes application use cases. SSE carries progress and invalidation; clients
re-query after reconnect or invalidation. Browser memory and events never
prove a lifecycle transition.

Bind an ephemeral loopback port. Serve one origin and require a per-launch
capability plus strict Origin validation for mutations. The browser never
accesses Git, SQLite, files, agents, or subprocesses directly. This ADR adds
no npm runtime dependency: any later Fastify, React DOM, or Vite tooling stays
in `devDependencies`, is bundled, and is audited under ADR 0044.

| Option | Result |
|---|---|
| React + Vite + Fastify | Accepted: matches the prototype and supplies a validated Node adapter. |
| Framework-free DOM + `node:http` | Rejected: makes the project own component lifecycle, routing, validation, and static serving. |
| Next.js or another SSR host | Rejected: local operator data needs no SEO or server rendering, and a second runtime conflicts with ADR 0044. |
| Electron | Rejected: adds a desktop runtime without a needed capability. |

## Consequences

The TUI and web board share application projections and use cases but render
separately. Production packaging gains browser assets and audited third-party
code; this ADR authorizes no implementation or dependency installation.

## Implementation and verification gates

A later mission must prove loopback-only binding, mutation authorization,
schema rejection, reconnect behavior, fail-closed results, and CLI
compatibility with mocked ports. UI display is never transition proof.

## Reconsideration triggers

Remote access, multi-user authentication, offline mutation, or persistence,
backup, recovery, or concurrency changes require a separate decision.

## References

- [React DOM client API](https://react.dev/reference/react-dom/client/createRoot)
- [Vite backend integration](https://vite.dev/guide/backend-integration)
- [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)

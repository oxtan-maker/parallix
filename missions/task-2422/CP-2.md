# CP-2: Replacement ADR draft

Replaced ADR 0054 with a React/Vite browser client and Fastify loopback adapter.
The adapter reads application projections, validates commands, invokes use
cases, and emits SSE progress/invalidation events. Same-origin serving,
per-launch mutation capability, strict Origin validation, and loopback binding
form the local security boundary.

ADR 0042 now treats `util.styleText` as a scoped standard-library choice rather
than evidence of a dependency ban. ADR 0046 now treats bundled packages as
audited dependencies even when npm installs no production `node_modules` tree.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Compact replacement ADR selects concrete frameworks | ADR 0054 | PASS |
| Browser remains an inbound adapter, not an authority | ADR 0051; ADR 0053; ADR 0054 | PASS |
| Local mutation security is explicit | ADR 0054 decision and consequences | PASS |
| Obsolete dependency constraint reconciled | ADR 0042; ADR 0046; ADR index | PASS |
| Unneeded architecture excluded | ADR 0054 rejects framework-free DOM, SSR host, and Electron; SSE avoids WebSockets | PASS |

Next action: measure the ADR, run documentation and project verification, and
capture the final evidence.

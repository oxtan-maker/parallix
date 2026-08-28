# CP-1: Architecture and framework research

The supplied board is a React-driven interactive prototype, not a static page.
It requires lanes, attention ranking, drag/drop command affordances, flow
metrics, and live operation feedback. The landed TUI already consumes
UI-neutral projections and application use cases, so the web client can reuse
those contracts without reusing terminal components or parsing CLI output.

Current official documentation supports React DOM for browser rendering, Vite
for browser builds integrated with an existing backend, and Fastify for a Node
host with route schemas. SSE covers the board's one-way progress and
invalidation stream; WebSockets and SSR add no required capability.

The old built-ins-only premise conflicts with the bundled Ink/React runtime and
ADR 0044's existing SBOM, notices, license audit, and release manifest.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Existing application/UI boundary traced | ADR 0051; `src/application/projections/mission-board.ts`; `src/interfaces/tui/` | PASS |
| Supplied interaction design inspected | `/tmp/Parallix Kanban Board Controller Web.zip` | PASS |
| Current browser and host frameworks researched | React DOM `createRoot`; Vite backend integration; Fastify validation and server references | PASS |
| Outdated dependency premise located | ADR 0042; ADR 0046; previous ADR 0054 | PASS |

Next action: replace ADR 0054 and reconcile ADRs that still describe a
project-wide built-ins-only constraint.

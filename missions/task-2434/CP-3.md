# CP-3: The anti-slop boundary, locked down by tests

## Summary

Added `test/web-board-render.test.ts` — focused tests that render the board
with transport-shaped fixtures and then scan the production browser sources for
the boundary this mission fixes.

Every fixture is built from `test/fixtures/board-projection.ts` and passed
through `toWebBoardSnapshot`, so the tests assert against the real wire shape
without restating a single domain rule. Coverage:

- **Populated** — repository identity, all six stages present *and in received
  order* (index positions asserted monotonic), every card id, the server's
  attention rank/reason kind/detail/action display, checkpoint, failing gate,
  next action, review round, flags, source facts with and without a value, and
  the operation log entry verbatim.
- **Empty** — six explicit empty-stage notices, an explicit empty attention
  queue, empty log and empty source facts, and an assertion that no session
  count is invented.
- **Unavailable / unknown** — `gate: 'unknown'` never renders as a pass, a
  `null` agent renders as absent, and the three `runningSessions` states
  (omitted / `null` / observed `0`) each render as themselves. An indefinite
  agent block renders as `indefinite` while a finite one renders `01:30`.
- **Narrow / wide** — the lane row carries `overflow-x:auto` and in-flight
  lanes keep `min-width:225px`, matching the reference artifact's overflow
  behaviour; the rendered markup contains no `display:none`, so no lane, card
  or action is hidden at any width.
- **Read-only** — every rendered `<button>` is `disabled` with no click
  handler, and the markup contains no `draggable`, `ondrag*` or `ondrop`.
- **Source scan** of `web/src/` — no `node:` import, no `src/adapters/`,
  `child_process`, `better-sqlite3`, `simple-git` or `fastify` reference; no
  `localStorage`/`sessionStorage`/`indexedDB`/`document.cookie`/`caches.`/
  `setInterval`/`EventSource`; exactly one `fetch(` in the whole client and it
  is in `board-data.ts`; no `method:` or HTTP verb literal; no embedded mission
  id, `missions/wk`, median, throughput, bottleneck, cycle time or `PR #`; and
  every quoted lane literal must be one of the two allowlisted layout-bucket
  declarations, with no `'px …'` command string anywhere.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Focused tests use transport-shaped fixtures for populated, empty, unavailable/unknown, narrow and wide views (SC8, DoD #1, DoD #4) | `npx tsx --test test/web-board-render.test.ts` — all tests pass; fixtures come from `test/fixtures/board-projection.ts` via `toWebBoardSnapshot` | Pass |
| Contract-only rendering, no derived replacement values (SC1, SC2) | "a populated snapshot renders repository identity and all six received stages in received order", "an unknown gate renders as unknown, never as a pass", "omitted, null and observed-zero running sessions each render as themselves", "an indefinite agent block never renders as a numeric duration" | Pass |
| No mutation path reachable from the rendered board (SC5) | "every rendered action is a disabled native control carrying the server display and state", "the rendered board carries no drag, drop or draggable affordance", "production browser code performs exactly one fetch and no mutating request" | Pass |
| No invented metrics or mock data in production browser code | "production browser code contains no mock mission data or invented metric" | Pass |
| No browser persistence, polling or reconnection | "production browser code uses no browser persistence or cached snapshot" | Pass |
| No Node built-in or concrete-adapter import in the browser bundle (DoD #2) | "production browser code imports no Node built-in, concrete adapter, or server module"; plus `npm run build:web` | Pass |
| Narrow layout preserves the reference overflow rather than hiding regions (SC4) | "narrow viewports scroll the board horizontally instead of dropping lanes" | Pass |
| No lifecycle mapping in the browser | "production browser code maps no lane to a lifecycle rule or command" | Pass |

Next action: CP-4 — capture headless Chromium screenshots of the implemented
board at the reference's wide and narrow viewport sizes, diff them against
`Parallix Board.dc.html`, resolve or record every accepted deviation, then run
`./scripts/verify-local.sh all`.

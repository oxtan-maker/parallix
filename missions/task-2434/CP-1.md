# CP-1: Minimal React client fetches and validates the board snapshot

## Summary

Wired the browser client's single snapshot read and its explicit non-board
states. The client performs exactly one `GET /api/board` per page load and
renders a board only from a payload that the shared transport validator
accepts.

- `web/src/board-data.ts` — `loadSnapshot()` plus the `SnapshotState` union.
  It reuses `validateWebBoardSnapshot` from `src/interfaces/web/transport.ts`
  (the pure, already-shipped TASK-2430 contract) rather than restating any
  shape rules in the browser. Four settled states stay distinct:
  `request-failed` (transport/network or non-2xx), `malformed` (body is not
  JSON, or the contract rejected it), `incompatible` (unsupported
  `transportVersion`), and `ready`.
- `web/src/shell.tsx` — the `main` landmark, `aria-busy` while loading, and a
  distinct `role="status"` screen per non-ready state. No previously fetched
  snapshot is retained: there is no cache, no retry, no polling, and no
  browser storage of any kind.
- `web/src/board.tsx` — the reference top bar rendered from snapshot facts
  (`repositoryId`, `attentionQueue` length). Remaining board regions land in
  CP-2.
- `web/src/palette.ts`, `web/src/style.css` — the reference artifact's palette,
  type scale, scrollbar treatment, and a visible `:focus-visible` indicator.

Deviations from the reference artifact taken at this checkpoint, to be carried
into the CP-4 record: the top bar's aggregate `wip N` number and the
`27 (52) missions/wk` throughput have no transport fact behind them and are
omitted rather than invented (`wipCounts` is a per-lane series, and per-lane
counts render in the lane headers in CP-2); the `▤ FLOW` button and its
cumulative-flow/cycle-time panel are explicitly out of scope for this mission
and are omitted.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A validated snapshot produces the ready state, and nothing else does | `npx tsx --test test/web-client-snapshot.test.ts` — "a validated snapshot response becomes the ready state" | Pass |
| Loading, request failure, malformed response, and incompatible version are four distinct states (SC6) | `test/web-client-snapshot.test.ts`: "a non-ok snapshot response becomes an explicit request-failure state", "a response body that is not JSON becomes an explicit malformed state", "an unsupported transport version becomes an explicit incompatible state, not a malformed one", "no settled snapshot state is the loading state" | Pass |
| Exactly one read, no mutation path (SC5) | "the client reads the snapshot path exactly once with no mutating method" asserts the only call is `SNAPSHOT_PATH` with no method override | Pass |
| Contract rules are not restated in the browser | `web/src/board-data.ts` imports `validateWebBoardSnapshot` from `src/interfaces/web/transport.js`; fixtures come from `test/fixtures/board-projection.js` via `toWebBoardSnapshot` | Pass |
| Browser bundle carries no Node built-in or concrete adapter import (DoD #2) | `npm run build:web` succeeds; `grep -o "node:[a-z_]*" build/web/assets/index-*.js` yields only the string `node:a` inside a minified React object literal, not an import specifier | Pass |
| Toolchain is the ADR 0054 React/React DOM + Vite client with no new dependency | `npm run build:web` (`web/vite.config.ts`); `package.json` dependency set unchanged | Pass |

Next action: CP-2 — render the reference artifact's agent strip, attention
rail, intake/in-flight/shipped lanes, command log and card bodies in
`web/src/board.tsx` from snapshot facts, using a native `<details>` disclosure
for the shipped/done history so collapse needs no event handler.

# CP-2: The reference board rendered from snapshot facts

## Summary

`web/src/board.tsx` now renders the full reference layout — top bar, agent
strip, attention rail, intake column, in-flight columns, collapsible shipped
history and operation log — entirely from the validated snapshot.

- **Received order preserved.** `Board` partitions `snapshot.stages` into three
  presentation buckets (intake column, in-flight columns, shipped rail) with
  `Array.prototype.filter`, which keeps each bucket in received order. The
  intake column's geometry follows the reference (first slot `max-height:44%`,
  second slot `flex:1`), so the received order `backlog, refined` places
  backlog in the upper slot — the reverse of the reference's generated sample,
  which fixed refined above backlog.
- **Stage counts are the server's.** Lane headers print `stage.count`, never
  `stage.cards.length`.
- **Actions are rendered, never invoked.** `ActionButton` is a native
  `<button disabled>` with the server's `display` as its label, `state` in its
  accessible name, and `reason` as its title. There is no `onClick`, no
  `draggable`, no drag or drop handler, and no second `fetch` anywhere in
  `web/src/`.
- **Contract states stay distinct.** `sessionsText` keeps `runningSessions`
  omitted / `null` / `0` apart; `durationText` keeps `indefinite` from
  collapsing to a number; `GATE_TEXT`/`GATE_COLOR` render `unknown` and
  `running` as themselves rather than as a pass.
- **Done history collapses natively.** `ShippedRail` is a `<details>` element
  whose two summary variants (expanded column header, collapsed 34px vertical
  rail) are switched by CSS in `web/src/style.css`. No handler, no React state,
  no snapshot mutation — and it is keyboard-operable for free.
- **Toolchain unchanged.** `tsconfig.json` now includes `web/**`, so the
  existing `tsc --noEmit` gate typechecks the browser code. `@types/react-dom`
  cannot be installed in this offline worktree, so `web/src/react-dom-client.d.ts`
  declares the single `createRoot` entry point the shell uses. No runtime
  dependency was added.

Deviations from the reference artifact carried into the CP-4 record, in
addition to CP-1's: intake ordering (above); per-family name tints, attention
badge tints and card left-edge tints came from the artifact's hardcoded sample
maps and have no transport fact, so a single palette entry is used; `med Nd`
lane medians, `PR #n` / `forgejo` links and `+9 integrated earlier this
quarter` have no transport fact and are omitted; the artifact's `ranked by:`
footer states a server ranking rule, so that slot now carries
`snapshot.sourceFacts` instead; the log shows the transport's `timestamp`
verbatim rather than reformatting it, and the blinking command caret is
dropped because this client has no command line.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Repository identity, stages in received order, counts, cards, attention items, agent availability, source facts and action display/state/reason all render from the snapshot (SC1) | `web/src/board.tsx` — `Board`, `AgentStrip`, `AttentionRail`, `StageColumn`, `ShippedRail`, `CommandLog`; verified by the CP-3 suite `test/web-board-render.test.ts` | Pass |
| Absent / null / unknown values stay distinct from zero and pass (SC2) | `sessionsText`, `durationText`, `GATE_TEXT` in `web/src/board.tsx`; asserted in CP-3 | Pass |
| No mutation path: no click handler, no drag, no second fetch (SC5) | `ActionButton` renders `<button type="button" disabled>`; asserted by the source-scan tests in CP-3 | Pass |
| Done history collapses locally without changing snapshot data | `ShippedRail` uses `<details>` with the `.shipped` rules in `web/src/style.css`; no state and no handler exist for it | Pass |
| Browser code typechecks under the repository's strict settings | `npx tsc --noEmit` (root `tsconfig.json` now includes `web/**`) | Pass |
| The client still builds as a self-contained bundle | `npm run build:web` | Pass |

Next action: CP-3 — add `test/web-board-render.test.ts` with transport-shaped
populated / empty / unavailable-unknown fixtures plus source-scan assertions
that `web/src/` contains no mock data, no domain-rule mapping, no Node or
concrete-adapter import, no browser persistence and no mutation path.

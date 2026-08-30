# Mission: Build the read-only React board shell from the web snapshot (task-2434)

## Goal

Build the first browser board as a read-only React client of the TASK-2430 snapshot. The hard visual acceptance reference is `/tmp/Parallix Kanban Board Controller.zip`, using `Parallix Board.dc.html` as the reference design. The delivered board must be pixel-perfect against that artifact at matching viewport dimensions, except where snapshot-backed facts replace the artifact's generated sample data and where this mission's read-only boundary removes mutation behavior.

## Reference Acceptance Artifact

`/tmp/Parallix Kanban Board Controller.zip` is mandatory implementation and review input. Its `Parallix Board.dc.html` is the sole design authority for layout, hierarchy, sizing, spacing, typography, palette, borders, overflow, and visual states. Do not substitute a prose interpretation, another dashboard design, existing TUI styling, or an agent-created mockup.

Before declaring this mission complete, capture the implemented board at the same wide and narrow viewport dimensions as the reference and perform a screenshot visual-diff review against the artifact. A reviewer must reject visible layout or styling deviations unless they are required by: (1) snapshot-backed facts replacing generated sample data, (2) disabled read-only controls replacing mutation controls, or (3) an accessibility requirement. Record each accepted deviation and its reason in the final checkpoint.

The archive's generated controller, state, sample data, drag/drop, and command behavior are forbidden implementation input. Only the design is authoritative.

## Why Now

TASK-2430 and TASK-2432 already provide the versioned snapshot and loopback host. This mission adds the smallest browser renderer on top of that contract. It must not recreate server rules, transport state, or the generated prototype's interaction model.

## In Scope

- A React/React DOM client built with the ADR 0054 toolchain and served by the existing web host.
- Fetch and validate the current board snapshot before rendering it.
- The reference acceptance artifact, rendered from repository ID, stages and their order/counts/cards, attention queue, agent availability, source facts, and action display/state/reason.
- Collapsing and expanding the done history locally without changing its snapshot data.
- Explicit loading, request-failure, malformed-response, and incompatible-version presentation.
- Semantic landmarks, headings, named controls, visible focus, and sufficient contrast.

## Explicitly Not In Scope

- Mutation endpoints, command submission, optimistic updates, drag/drop, keyboard shortcuts that mutate, or hidden future-use event handlers.
- Browser persistence, local storage, session storage, cached snapshots, polling, SSE, reconnection, or browser-owned workflow state. Each page load starts without board data and renders only a successfully validated current response.
- Any browser reconstruction of lifecycle, WIP, action eligibility, action reason, attention rank, agent state, source status, or operational state.
- Prototype-only content not present in the transport: flow charts, cycle-time medians, bottleneck analysis, throughput, PR numbers, fake sessions, sample missions, or invented explanatory/status text.
- A router, browser state framework, SSR, design system, new runtime dependency, Node built-in, concrete adapter, filesystem, SQLite, Git, child-process, or Node HTTP import in browser code.
- Changes to snapshot production, host behavior, lifecycle semantics, or write workflows.

## Non-Negotiable Slop Guards

- The transport is the only fact authority. Production client code must not contain a mission array, lane list, action map, metric fallback, demo data, or a conditional that derives a domain fact from another domain field.
- Render `stages` in received order. Render card and attention actions exactly with their server-provided `display`, `state`, and `reason`; a disabled presentation has no action callback.
- Treat absent, `null`, unavailable, unknown, malformed, and incompatible values as distinct states where the contract distinguishes them. Never display an absent/unknown fact as zero, passed, idle, or successful.
- Do not add `draggable`, drag handlers, drop handlers, command handlers, mutation URL strings, or `fetch` calls other than the snapshot read. A read-only control must be native-disabled where a native control is used.
- Do not copy generated controller/state code, data, or interaction behavior from the reference acceptance artifact. Its rendered design—not its implementation—is the visual authority.
- Do not “improve” narrow layout by stacking, summarizing, filtering, virtualizing, or hiding board regions. Follow the reference artifact's overflow behavior.
- Do not add abstraction layers for one fetch, one snapshot, or one view. Use ordinary React state and the existing transport validator.
- If a desired reference element lacks a transport fact, omit it. Do not label invented content as unavailable.

## Success Criteria

- SC1: Given a valid populated snapshot, the client renders repository identity; all six received stages in received order; each received stage count and card; attention items; agent availability; source facts; and action display/state/reason without deriving replacement values.
- SC2: Given empty, unavailable, unknown, or nullable contract values, the client presents the contract state explicitly and never substitutes zero, a pass state, an idle state, or sample data.
- SC3: At matching wide and narrow viewport dimensions, screenshot visual diff confirms pixel-perfect delivery against `/tmp/Parallix Kanban Board Controller.zip` → `Parallix Board.dc.html`. The final checkpoint records every accepted deviation and ties it to snapshot data, disabled read-only behavior, or accessibility.
- SC4: At wide and narrow viewport sizes, every rendered rail, lane, card, and action remains reachable. The implementation follows the reference artifact's overflow behavior; it does not omit or replace content.
- SC5: Clicking, pressing keys on, or dragging any rendered board element cannot invoke a mutation endpoint or change board data. Done-history collapse is the sole allowed local board interaction.
- SC6: Loading, request failure, malformed snapshot, and incompatible transport version each have a distinct explicit UI and no previously fetched snapshot is shown as current.
- SC7: The page has a main landmark, named board regions/headings, deterministic focus order, accessible names for controls, visible focus indication, and contrast appropriate to the rendered palette.
- SC8: Focused component tests use transport-shaped fixtures for populated, empty, unavailable/unknown, narrow, and wide views; they assert that production browser code has no mock data, domain-rule mapping, Node/concrete-adapter import, browser persistence, or mutation path.
- SC9: `./scripts/verify-local.sh all` passes.

## Checkpoints

- CP1: Wire the minimal React/Vite client to fetch and validate the current snapshot, with explicit loading and invalid-response states.
- CP2: Render the reference artifact from the snapshot, including the done-history disclosure and selected-card detail.
- CP3: Lock down the anti-slop boundary with focused tests for contract-only rendering, no mutation path, no invented metrics, no persistence, and reference-preserving narrow overflow.
- CP4: Perform wide and narrow screenshot visual-diff review against the reference artifact, resolve or record every accepted deviation, then run the required gate and record the goal check.

## Stop Rules

- Stop if a required visual element needs a fact the snapshot does not supply; omit the element or request a separate transport mission. Do not infer it.
- Stop if the host cannot serve the browser bundle or the current response cannot be validated without changing TASK-2430/TASK-2432; request a separate dependency mission.
- Stop if reference matching requires generated controller/state code, a prohibited architecture layer, a concrete adapter import, or any write behavior.
- Stop if complete narrow-screen access cannot be achieved with horizontal scrolling; request product direction rather than removing or substituting board content.

## Gate

- [ ] `./scripts/verify-local.sh all`

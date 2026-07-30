---
id: TASK-2329
title: Bring TUI board to design parity with agent slop guardrails
status: review
assignee: [custom]
created_date: '2026-07-30 00:00'
updated_date: '2026-07-30 00:00'
labels:
  - tui
  - board
  - ui
  - user_value
dependencies: []
references:
  - /tmp/Parallix Kanban Board Controller.zip (design source — HTML mockup only)
  - src/interfaces/tui/shell.tsx
  - src/interfaces/tui/board-layout.tsx
  - src/interfaces/tui/lane-column.tsx
  - src/interfaces/tui/mission-card.tsx
  - src/interfaces/tui/flow-panel.tsx
  - src/interfaces/tui/action-bar.tsx
  - src/application/projections/board.ts
  - src/application/projections/mission-board.ts
  - src/application/projections/agent-status.ts
  - src/application/controller/board-command.ts
  - src/application/controller/board-controller.ts
  - backlog/tasks/task-2283 - Implement-local-web-operator-board-over-shared-contracts.md
  - backlog/tasks/task-2322.11 - Complete-operator-state-repositories-and-shared-UI-projection-wiring.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The TUI board (`px ui`) is partially implemented against the design in `/tmp/Parallix Kanban Board Controller.zip`. Multiple prior missions have contributed features incrementally, leaving accumulated agent slop: duplicate logic paths, partially-wired projection data, and UI components that render only a subset of the design's information hierarchy. This task completes the TUI board to design parity by finishing the partly-done features rather than creating new parallel code.

The design is a **web UI mockup** (dc-runtime HTML). We are interested **only in the TUI** — the design's information hierarchy, action model, and operator experience drive the TUI implementation; its web architecture, styling, and drag/drop interactions are not copied verbatim. Terminal keyboard equivalents replace mouse interactions.

**Guardrail:** Every sub-mission must extend existing files (`src/interfaces/tui/*.tsx`, `src/application/projections/*.ts`, `src/application/controller/*.ts`) and domain types. New files are only permitted when the existing module exceeds 300 lines and the new concept has a distinct lifecycle. No new top-level directories under `src/interfaces/tui/` or `src/application/projections/` without an ADR note.
<!-- SECTION:DESCRIPTION:END -->

## Design vs. Current Implementation Gap

### Implemented (carry forward, do not duplicate)
- Top bar: repo identity, WIP count, attention count, FLOW toggle
- Attention rail: ranked items with reason, why text, suggested command
- Six lane columns (backlog, refined, active, review, integration, done)
- Mission cards: slug, agent, title, checkpoint, gate, next action, PR/review, blocking reason
- FLOW panel: textual metrics (cumulative flow, cycle time, bottleneck narrative, agent availability)
- Command log with operation entries
- Keyboard navigation (arrows/WASD) across lanes and cards
- Tab/Shift+Tab focus switching between rail and board
- Confirmation dialog for consequential actions
- Outcome banner for command results
- Stale/unavailable source indicators
- Mission detail panel
- Action bar showing command availability

### Missing — bring partly-finished parts to completion

#### 1. Agent family strip (above board, below top bar)
- **Design:** Horizontal strip showing each agent (codex, claude, mistral, custom) with a colored status dot (green=available, red=blocked), agent name in color, running session count, and block countdown for blocked agents.
- **Current:** `AgentAvailabilityRow` exists in `agent-status.ts` with `family`, `available`, `blockedForMs`, `reason`, `expiresAtMs`. The `BoardMetrics.agentAvailability` array carries this data. The TUI shell does **not** render it in a strip; it only appears in the FLOW panel's READ section as "family available/unavailable".
- **Work:** Add an `AgentStrip` component rendered between the top bar and the main area (or the FLOW panel). Show colored dots, agent name, session count from `mission-card.tsx` agent field aggregation, and countdown for blocked agents. Reuse existing `AgentAvailabilityRow` — do not create a new projection type.
- **Sloping risk:** Do not introduce a new agent-status projection or separate read adapter. The data path already exists through `BoardMetrics.agentAvailability`.

#### 2. On-card contextual action buttons
- **Design:** Each card shows state-appropriate action buttons directly on the card (e.g., active cards: "ckpt", "review ▸"; review cards: "approve", "findings ↩"; approved cards: "integrate ▸"; blocked cards: "resume ▸", "retry:codex ▸").
- **Current:** `ActionBar` at the bottom shows all 7 command kinds with enabled/disabled state. Only `active:execute` is dispatchable from the TUI. Other commands are unavailable per `INTEGRATED_CAPABILITIES` in `board-command.ts`.
- **Work:** Add inline action buttons to `MissionCard` for the currently integrated capabilities (`active:execute`, `checkpoint:record`, `handoff:record`). When the projection provides command availability on the card (`card.commands[]`), render only the enabled ones as compact buttons on the card. The bottom `ActionBar` remains for diagnostic visibility. This uses the existing `MissionCard.commands` array — no new projection data needed.
- **Sloping risk:** The on-card buttons must dispatch through the same `BoardCommandController` path as the action bar. Do not create a second dispatch mechanism or inline command logic in the card component.

#### 3. WIP limit indicators in lane headers
- **Design:** Lane headers show WIP as "count/limit" with yellow highlighting when over limit (e.g., "2/3" in gray, "4/3" in yellow bold).
- **Current:** `LaneColumn` renders count only (e.g., "ACTIVE 3"). No WIP limit concept exists in `BoardProjection.wipCounts` (which carries `lane` + `count` but no limit).
- **Work:** Add optional `wipLimit?: number` to `WipCountMetric`. When present, render "count/limit" in the lane header with color change on overage. The limit is configured (not derived) — source from a future `BoardPreferences` projection when available, or from a config constant initially.
- **Sloping risk:** Do not introduce a new configuration file or CLI flag for WIP limits in this task. Use a constant or projection-default until the preferences repository (TASK-2322.11) is ready.

#### 4. Median cycle time in lane headers
- **Design:** Each lane header shows median cycle time (e.g., "med 1.8d").
- **Current:** `BoardMetrics.medianCycleTimeByState` carries per-lane median cycle time data. It is rendered only in the FLOW panel, not in lane headers.
- **Work:** Pass `medianCycleTimeByState` from the projection to `LaneColumn` and render the median value in the lane header when available. Use the existing `LaneMetricSeries` — no new projection data.
- **Sloping risk:** Do not add a new metrics query or adapter. The data already flows through `BoardProjection.metrics.medianCycleTimeByState`.

#### 5. Classification labels on mission cards
- **Design:** Cards show a classification badge (e.g., "user_value", "bug", "infra", "perf", "ux", "hygiene").
- **Current:** `MissionCard.labels` carries the label array from the domain `MissionLabel` type. The `MissionCard` component does not render labels.
- **Work:** Render the first label as a compact badge on the card header, using the existing `card.labels[0]`. No new projection data.
- **Sloping risk:** Do not create a label-to-color mapping in the TUI. The design uses color in the web UI; the TUI renders the label text in a bordered badge.

#### 6. Keyboard-driven lane transitions (drag-and-drop equivalent)
- **Design:** Drag and drop cards between columns to execute lifecycle commands (draft, activate, review, integrate).
- **Current:** No keyboard shortcut for moving a selected card to a different lane. Navigation moves selection; Enter triggers `active:execute`.
- **Work:** Add keyboard shortcuts that move the selected card to an adjacent lane, dispatching the appropriate command through `BoardCommandController`. Map: `Ctrl+D` = draft (backlog→refined), `Ctrl+A` = activate (refined→active), `Ctrl+R` = review (active→review), `Ctrl+I` = integrate (integration→done). These are placeholders until the corresponding capabilities are integrated; show "unavailable" outcome when the command is not in `INTEGRATED_CAPABILITIES`.
- **Sloping risk:** Do not create a new keyboard navigation system. Extend the existing `KeyHandler` in `shell.tsx` and the `NavigationKey` type.

#### 7. Collapsible shipped/done column
- **Design:** The shipped column collapses to a narrow strip (34px) showing "◂ SHIPPED · N" when closed, expanding on click.
- **Current:** The done column is always visible at full lane width.
- **Work:** Add a `shippedCollapsed` state to `BoardShell`. When collapsed, render the done column as a narrow strip with the count. Toggle with a keyboard shortcut (e.g., `Shift+S`). This is a layout toggle in the TUI — no projection changes.
- **Sloping risk:** Do not introduce a new component. Toggle the width of the existing `LaneColumn` for the `done` lane.

#### 8. Richer review details on cards
- **Design:** Review cards show "R2 · 2 blocking" and "PR #47 forgejo".
- **Current:** Cards show PR number and review approval status but not review round count or blocking finding count.
- **Work:** The `MissionCard` already has `pullRequest` (with PR id) and `reviewApproved`. Add `reviewRound` and `blockingFindings` display from the existing `MissionDetail` projection when available. For the card-level view, use `card.flags` to surface blocking review info.
- **Sloping risk:** Do not add new fields to `MissionCard` for this. Use the existing `flags` array and `pullRequest` reference. If richer review data is needed, that is a separate projection enhancement (TASK-2322.06 scope).

## Agent Slop Guardrails

Each sub-mission implementing one of the items above must follow these rules:

1. **Extend, do not replace.** Every change touches existing files. A sub-mission that creates a new `.tsx` file must justify why the concept cannot fit in an existing module (limit: existing file > 300 lines and the new concept has a distinct lifecycle from the module's current responsibility).

2. **No new projection types.** The `BoardProjection`, `MissionCard`, `BoardMetrics`, and `WipCountMetric` types are the data contract. Sub-missions consume what is already projected. Adding a new field to a projection type requires a one-paragraph justification in the mission's CP-1.

3. **No new read adapters.** The `BoardProjectionBuilder` and its adapters (`MissionReadAdapter`, `ReviewReadAdapter`, etc.) are stable. Sub-missions do not introduce new adapters or modify existing ones unless the missing data is a confirmed gap (not a "nice to have").

4. **One capability per sub-mission.** Each numbered item above is a single sub-mission. Do not combine items or split an item into multiple sub-missions unless the scope exceeds one checkpoint.

5. **Tests before features.** Each sub-mission's first checkpoint characterizes the current behavior (rendering test or integration test for the TUI component), then extends it. No sub-mission merges without a test that would have failed before the change.

6. **No inline command logic in UI components.** Action buttons dispatch through `BoardCommandController`. The `MissionCard` and `LaneColumn` components never call `px active`, `px checkpoint`, or similar CLI commands directly.

7. **Keyboard help text updated.** Any new keyboard shortcut adds its binding to the shell's keyboard help string and the `?` help toggle.

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Agent family strip renders above the board with status dots, agent names, session counts, and block countdowns using existing `BoardMetrics.agentAvailability` data
- [ ] #2 On-card action buttons show enabled commands from `MissionCard.commands[]` and dispatch through the existing `BoardCommandController` path
- [ ] #3 Lane headers display WIP count with optional limit and color-coded overage
- [ ] #4 Lane headers display median cycle time from `BoardMetrics.medianCycleTimeByState`
- [ ] #5 Mission cards render classification label badge from `MissionCard.labels[0]`
- [ ] #6 Keyboard shortcuts (Ctrl+D/A/R/I) move selected cards between lanes via the existing command dispatch path
- [ ] #7 Shipped/done column collapses to a narrow strip and expands on keyboard toggle
- [ ] #8 Review cards display review round and blocking findings using existing `MissionCard` fields
- [ ] #9 No new `.tsx` files created under `src/interfaces/tui/` without justification (existing module > 300 lines)
- [ ] #10 No new projection types or read adapters introduced
- [ ] #11 Each sub-mission has a characterization test that fails before the change
- [ ] #12 Keyboard help text documents all new bindings
- [ ] #13 Static analysis and test hygiene pass on every changed file
<!-- AC:END -->

## Sub-Mission Breakdown

| Sub-mission | Item | Files touched | New file? |
|---|---|---|---|
| task-2329.01 | Agent family strip | `shell.tsx`, `agent-strip.tsx` | Yes — distinct component (25 lines) |
| task-2329.02 | On-card action buttons | `mission-card.tsx`, `action-bar.tsx` | No |
| task-2329.03 | WIP limit indicators | `lane-column.tsx`, `board.ts`, `board-layout.tsx` | No |
| task-2329.04 | Median cycle time in headers | `lane-column.tsx`, `board-layout.tsx` | No |
| task-2329.05 | Classification labels on cards | `mission-card.tsx` | No |
| task-2329.06 | Keyboard lane transitions | `shell.tsx`, `navigation.ts` | No |
| task-2329.07 | Collapsible shipped column | `board-layout.tsx`, `shell.tsx` | No |
| task-2329.08 | Richer review details on cards | `mission-card.tsx` | No |

## Comments

<!-- COMMENTS:BEGIN -->
author: magnus
created: 2026-07-30 00:00
---
Design source is the HTML mockup in `/tmp/Parallix Kanban Board Controller.zip`. The actual code in the zip (dc-runtime, React web components) is NOT the target — we use only the information hierarchy and operator experience. The TUI implementation already covers ~60% of the design's features; this task completes the remaining ~40% by extending existing code paths rather than creating new ones.
---
<!-- COMMENTS:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

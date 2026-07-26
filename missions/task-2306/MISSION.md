# Mission: Ink TUI wave 4 — attention queue selection, exact-command preview, read-only (task-2306)

## Goal

Make the Ink TUI attention rail interactive and semantically complete: selecting an attention item focuses the corresponding board card (and vice versa), each item displays the exact application command an operator would run, and the panel renders explicit states for empty queues and unavailable sources — without executing any command.

## Why Now

Waves 1-3 (TASK-2282, TASK-2303, TASK-2305) deliver a navigable, read-only board with keyboard navigation, mission detail, and PTY smoke harness. The attention rail in the current `BoardShell` renders `BoardProjection.attentionQueue` but lacks two capabilities the design reference requires: bidirectional selection between the attention rail and the lane-view cards, and explicit "not yet available" messaging on the run affordance. Wave 4 closes that gap so wave 5 (TASK-2307) can focus entirely on command dispatch through `BoardCommandController` without backfilling UI plumbing.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: add selection callbacks to `AttentionItems`, wire `selectedMissionId` into attention rail, add run-affordance "wave 5" message, explicit empty/unavailable states, narrow-terminal layout assertion, and semantics-driven component tests.

## Scope

- Wire `selectedMissionId` from `BoardShell` into `AttentionItems` so the currently selected attention item is visually distinguished (e.g., `▶` prefix matching the board card style).
- Add click/keypress selection on attention items: pressing Enter on a focused attention item sets `selectedMissionId` in `BoardNavigationState`, which the `BoardLayout` already uses to highlight the corresponding lane card.
- Ensure selecting a lane card also highlights the matching attention item (bidirectional sync through the shared `selectedMissionId` in `BoardNavigationState`).
- Each attention item renders the exact application command text (`px integrate <slug>`, `px review <slug>`, etc.) derived from `attentionCommand()` in `shell.tsx`, matching what `BoardCommandController` would receive.
- Activating the run affordance (Enter on the command line) dispatches nothing and renders "execution arrives in wave 5 (TASK-2307)" — proved by a component test.
- Empty attention queue renders explicit text ("nothing needs attention") rather than a blank panel.
- Queue items referencing missing or unavailable sources render an explicit indicator (e.g., `⚠ unavailable`) rather than silently appearing valid.
- Narrow-terminal layout: when `railBeside` is false (terminal too narrow for side-by-side), the attention rail moves above the board and the top-ranked item remains visible without being hidden by the lane stack.
- Component tests assert semantics (rank order, reason kinds, command text, selection sync) rather than snapshots alone.
- Headless CLI compatibility and `tui-headless-isolation` test remain green.

## Out of Scope

- Command dispatch, progress rendering, confirmation dialogs, capability guards, stale refresh, cancellation, and progress indicators — all wave 5 (TASK-2307).
- Analytics and usage tracking — wave 6 (TASK-2308).
- Default invocation and auto-focus rules — wave 7 (TASK-2309).
- Changes to `BoardProjection.attentionQueue` data model or `attentionRank`/`attentionReason` logic in the application layer (these are reused as-is).
- Web board or non-Ink interfaces.
- Any modification to `lib/` (legacy command modules outside the TUI path).

## Success Criteria

- SC1: `AttentionItems` component accepts and renders a `selectedMissionId` prop; the focused attention item displays a `▶` prefix matching `MissionCard` focus rendering, verified in `test/tui-wave-4-attention.test.ts`.
- SC2: Selecting an attention item by keyboard (Enter/Return) updates `BoardNavigationState.selectedMissionId` to the item's `missionId`, causing the corresponding lane card in `BoardLayout` to render with `selected=true`, verified by `ink.renderToString` asserting both `▶` markers appear in output.
- SC3: Selecting a lane card updates `selectedMissionId` and the matching attention item in the rail renders with the `▶` focus prefix, verified in the same test suite.
- SC4: Each attention item renders the exact command string produced by `attentionCommand()` from `shell.tsx`; the command text matches the pattern `px <command> <mission-id>` (e.g., `px integrate task-1234`), verified by asserting rendered output contains the exact string.
- SC5: Activating the run affordance (pressing Enter on an attention item's command line) dispatches no application command and the rendered output contains the text "wave 5" or "TASK-2307", verified by a test that sends the Enter key and asserts no command was invoked.
- SC6: Empty attention queue renders the text "nothing needs attention" in `ink.renderToString` output, verified for both wide (columns ≥ 120) and narrow (columns = 60) layouts.
- SC7: Queue items with `sourceFacts` status `unavailable` or `stale` render an explicit `⚠` indicator in the attention rail, verified by injecting `sourceFacts` with `status: 'unavailable'` into the projection fixture.
- SC8: Narrow-terminal layout (columns = 60) renders the attention rail above the board with the top-ranked attention item text visible in output; `railBeside` is `false` at this width.
- SC9: Component tests in `test/tui-wave-4-attention.test.ts` assert rank order (numeric comparison), reason kinds (`blocking`, `gate-failed`, `review-lane`, `integrate-lane`), and exact command text — not snapshot-only comparisons.
- SC10: `test/tui-headless-isolation.test.ts` passes unchanged; no new `react` or `ink` imports appear in the headless module graph from `src/platform/runtime/index.ts`.
- SC11: `./scripts/verify-local.sh all` passes on the final tree.

## Risks and Assumptions

- **Risk: Selection state coupling.** The attention rail and board lanes share `selectedMissionId` via `BoardNavigationState`. If the attention rail introduces its own local selection, the two surfaces could disagree. Mitigation: the shared state is the single source; attention items read `selectedMissionId` and write through the same `setNavigation` callback.
- **Risk: Narrow layout overflow.** The attention rail stacked above the board could push lane columns out of the visible area on very short terminals (rows < 20). Mitigation: the narrow layout caps the rail at 5 items (matching the current `slice(0, 5)`) and the test asserts the top-ranked item remains visible.
- **Risk: `ink.renderToString` truncation.** Ink's Yoga layout may truncate command text in narrow columns, making exact-command assertions fragile. Mitigation: tests use wide terminal widths (columns ≥ 120) for command-text assertions and narrow widths only for layout-breakpoint tests.
- **Assumption:** `BoardProjection.attentionQueue` is populated by the composition root (`createBoardProjectionBuilder`) and contains all cards with non-`none` attention reasons. The mission does not change how the queue is built.
- **Assumption:** The `attentionCommand()` function in `shell.tsx` already produces the correct command text for each reason kind; the mission wires it into the rendered output rather than rewriting the mapping.
- **Assumption:** Wave 5 (TASK-2307) will introduce `BoardCommandController` and its dispatch plumbing; wave 4 only needs to prove nothing is dispatched.

## Checkpoints

- CP 1: Attention item selection and bidirectional sync. Wire `selectedMissionId` into `AttentionItems`, add Enter key handler that updates `BoardNavigationState`, and verify both surfaces highlight the same mission. Tests in `test/tui-wave-4-attention.test.ts`.
- CP 2: Exact command preview and run-affordance "wave 5" message. Assert each attention item renders the exact `px <cmd> <slug>` string. Prove activating the run affordance dispatches nothing and shows the wave-5 notice. Tests in `test/tui-wave-4-attention.test.ts`.
- CP 3: Empty queue, unavailable sources, and narrow layout. Assert explicit rendering for empty queues, stale/unavailable sources, and the narrow-terminal layout where the rail stacks above the board. Tests in `test/tui-wave-4-attention.test.ts`.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/interfaces/tui/shell.tsx:120` (must point to an existing file and line)
  2. **Test names** — e.g., `"attention item selection focuses board card"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/tui-wave-4-attention.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0051` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `npm test -- test/tui-wave-4-attention.test.ts` ``, or `` `node --import tsx test/tui-wave-4-attention.test.ts` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. **Failure mode:** raw `stat`/`ls` output or generic prose alone is not enough; it must be paired with a file:line reference, test name, test file path, ADR reference, or recognized command to be accepted as evidence.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Attention item shows focus prefix | `src/interfaces/tui/shell.tsx:145`, `test/tui-wave-4-attention.test.ts`, `"AttentionItems renders ▶ for selected mission"` | PASS |
| Bidirectional selection sync | `test/tui-wave-4-attention.test.ts`, `"selecting lane card updates attention rail focus"` | PASS |
| Exact command text rendered | `test/tui-wave-4-attention.test.ts`, `"attention command matches px integrate task-1234"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates

- [ ] `./scripts/verify-local.sh all`

## Restricted Areas

- `src/application/projections/board.ts` — do not modify `attentionQueue` data model or `buildBoardProjection` ranking logic; reuse as-is.
- `src/application/projections/mission-board.ts` — do not modify `attentionRank()`, `attentionQueue()`, or `MissionCard` interface.
- `src/interfaces/tui/navigation.ts` — `BoardNavigationState` and `moveSelection` may be used but should not be restructured; add selection support through the existing `selectedMissionId` field.
- `test/tui-headless-isolation.test.ts` — must not be modified; the headless entry module graph must remain free of `react`/`ink` imports.
- `lib/` — legacy command modules are out of scope for this mission.
- `src/application/` (non-projection modules) — do not introduce new use cases or ports in this wave.

## Stop Rules

- Stop if the attention queue data model in `BoardProjection` requires structural changes (new fields or enum values) — that belongs in a separate application-layer mission.
- Stop if `attentionCommand()` needs to call into `BoardCommandController` or any new adapter — command dispatch is wave 5.
- Stop if implementing the run affordance requires adding a new port, composition-root wiring, or lifecycle state mutation — all wave 5.
- Stop if the headless-isolation test (`test/tui-headless-isolation.test.ts`) begins failing because of new imports in the headless module graph.
- Stop if more than two new test files are needed — the mission should fit into one test file (`test/tui-wave-4-attention.test.ts`) plus the existing test suite.

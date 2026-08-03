# Mission: Bring TUI board to design parity with agent slop guardrails (task-2329)

## Goal
Complete the existing `px ui` board's remaining design-derived operator features by extending its established TUI, projection, and command-controller paths: agent availability strip, enabled on-card actions, lane WIP and median-cycle metrics, classification badges, lifecycle shortcuts, collapsible shipped lane, and review-detail presentation.

## Why Now
The board already projects most of the information needed for these features, but the TUI exposes it unevenly after incremental missions. Completing the missing presentation and interaction paths now gives operators the intended board hierarchy without creating duplicate projections, adapters, or command dispatch mechanisms.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: The backlog identifies eight bounded, design-derived enhancements and names the existing types and controller paths to extend.
- Main drivers: Eight TUI capabilities; characterization coverage before each capability; reuse of `BoardMetrics`, `MissionCard.commands`, and `BoardCommandController`; keyboard-help updates.

## Scope
- Render an agent-family strip from `BoardMetrics.agentAvailability`, including availability state, family name, active-session count aggregated from card agent fields, and blocked-agent countdown.
- Render compact, enabled inline actions from `MissionCard.commands` and route every action through `BoardCommandController`.
- Add configured optional WIP limits to lane metrics and show `count/limit` plus an over-limit terminal treatment in lane headers.
- Render each lane's existing median-cycle-time metric in its header.
- Render `MissionCard.labels[0]` as a text badge in the mission-card header.
- Extend the existing shell navigation handling with Ctrl+D, Ctrl+A, Ctrl+R, and Ctrl+I lifecycle shortcuts, including unavailable outcomes for non-integrated capabilities and corresponding help text.
- Add the `shippedCollapsed` board-shell state and use the existing done `LaneColumn` as a keyboard-toggleable narrow shipped strip.
- Surface existing review flags and pull-request references in review cards to show review round/blocking-findings information where projected.
- Add or extend characterization/rendering tests for each capability before its implementation work.
- adhere to the design in /tmp/Parallix Kanban Board Controller.zip
## Out of Scope
- Reproducing the HTML mockup's web architecture, CSS styling, mouse drag-and-drop, or dc-runtime components.
- Creating new top-level directories under `src/interfaces/tui/` or `src/application/projections/`.
- Adding a new board read adapter, a parallel projection type, a new metrics query, a new WIP configuration file, a CLI flag, or a preferences repository.
- Integrating currently unavailable lifecycle command capabilities beyond reporting their unavailable outcome.
- Adding richer review fields to the card projection when the existing flags and pull-request data cannot supply them; that remains the separate projection-enhancement scope.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: The board renders one agent-strip entry for every `BoardMetrics.agentAvailability` row, with an availability dot, family name, aggregated session count, and blocked countdown when `blockedForMs` is present.
- SC2: A mission card renders compact buttons only for enabled entries in `MissionCard.commands`; activating each button invokes the existing `BoardCommandController` route used by the action bar.
- SC3: A lane with `wipLimit` renders `count/limit`, and a count greater than the limit receives the specified over-limit terminal styling; a lane with no limit continues to render its count.
- SC4: A lane whose state has an entry in `BoardMetrics.medianCycleTimeByState` renders that median in its header; lanes without an entry remain renderable.
- SC5: A card with at least one label renders `MissionCard.labels[0]` as a bordered text badge, and a card with no labels remains renderable.
- SC6: Ctrl+D, Ctrl+A, Ctrl+R, and Ctrl+I on a selected card request draft, activate, review, and integrate respectively through the existing command dispatch path; unavailable capabilities produce the existing unavailable outcome; the keyboard help and `?` help list all four bindings.
- SC7: Shift+S toggles the done lane between its standard lane rendering and a narrow `SHIPPED · N` strip without changing the board projection.
- SC8: Review cards render available review-round and blocking-findings information from existing card flags and pull-request references without adding fields to `MissionCard` or a review read adapter.
- SC9: Each of SC1–SC8 has a focused characterization or rendering test that is authored before the capability implementation and would fail against the parent commit's behavior.
- SC10: No new `.tsx` file is added under `src/interfaces/tui/` unless its parent module exceeds 300 lines, it has a distinct lifecycle, and CP-1 records that justification; no new top-level TUI or projection directory, projection type, or read adapter is introduced.
- SC11: `./scripts/verify-local.sh all` completes successfully on the completed mission tree.

## Risks and Assumptions
- Assumption: `BoardMetrics.agentAvailability`, `medianCycleTimeByState`, `MissionCard.commands`, `MissionCard.labels`, `MissionCard.flags`, and pull-request references carry the data described by the backlog; implementation must characterize their current behavior before relying on it.
- Risk: session counts require card-agent aggregation; the aggregation must be display-only and must not create an agent-status projection or read adapter.
- Risk: terminal layout constraints can make the shipped-strip width or an agent strip wrap; preserve keyboard focus and board navigation under constrained dimensions.
- Risk: lifecycle capability availability is intentionally partial; keyboard shortcuts must reuse the controller and report unavailable commands instead of executing CLI commands or inventing transitions.
- Risk: review round and blocking-finding values may not be encoded in existing flags for every card; render only available information and stop rather than expanding the projection contract.

## Checkpoints
- CP 1: Before feature changes, add focused characterization/rendering tests covering the current projection-to-TUI paths for agent availability, card commands and labels, WIP/median metrics, shell shortcuts, done-lane layout, and review flags; document any confirmed data gap and the required reuse path.
- CP 2: Implement and verify the data-display enhancements: agent strip, enabled on-card actions, WIP-limit/median lane headers, label badge, and review details, extending existing modules only.
- CP 3: Implement and verify interaction/layout enhancements: controller-routed lifecycle shortcuts with help text and unavailable outcomes, plus the keyboard-toggleable collapsed shipped lane.
- CP 4: Audit changed files against the slop guardrails, run the repository verification gate, and record evidence for every success criterion.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include a summary of work done and an exact `## Goal Check` heading followed by this 3-column pipe-delimited table: `| Criterion | Evidence | Status |`.

Include at least one evidence row for every applicable success criterion. Accepted evidence is an existing file:line reference, an exact repository test name, a test file path, an ADR reference, or a recognized repository command/path such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. Cite the characterization test path and exact name before implementation, then cite the changed file:line and the relevant verification command after implementation.

Raw `stat`/`ls` output and generic prose alone are insufficient evidence: when included, pair shell output with an accepted reference above. End every checkpoint document with a concrete `Next action:` line naming the remaining capability, verification step, or audit.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SC2 controller-routed on-card actions | `src/interfaces/tui/mission-card.tsx:line`, exact focused test name | PASS |
| SC6 lifecycle shortcuts and help text | `src/interfaces/tui/shell.tsx:line`, exact focused test name | PASS |
| SC11 verification gate | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not create a new TUI or projection top-level directory, a read adapter, a new board projection type, a metrics query, WIP configuration file, or CLI flag.
- Do not add direct `px active`, `px checkpoint`, `px handoff`, or lifecycle CLI calls to `MissionCard`, `LaneColumn`, or any other TUI component; command execution stays in `BoardCommandController`.
- Do not add a `.tsx` file under `src/interfaces/tui/` unless the target existing module is over 300 lines and the new component has a distinct lifecycle; record the justification in CP-1.
- Do not expand review projection data when existing flags and pull-request references cannot express a value.

## Stop Rules
- Stop and request scope direction if an acceptance criterion requires a new projection type, read adapter, metrics query, configuration file, CLI flag, or top-level TUI/projection directory.
- Stop and request scope direction if an inline action or keyboard binding cannot reach `BoardCommandController` without adding a second dispatch path or embedding CLI logic in a component.
- Stop and report the confirmed limitation if required review-round or blocking-finding data is absent from existing flags and pull-request references.
- Stop and request a layout decision if the agent strip or collapsed shipped lane breaks focus/navigation at supported terminal dimensions and cannot be corrected within existing layout components.

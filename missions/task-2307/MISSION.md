# Mission: Ink TUI wave 5 — guarded actions, confirmation, cancellation, and progress/operation log (task-2307)

## Goal
Connect the Ink TUI to the existing `BoardCommandController` so the board can dispatch guarded lifecycle commands, render confirmation prompts for consequential actions, handle cooperative cancellation with ADR 0051 safe-boundary semantics, and display progress events and the operation log as ordered diagnostic data — without the TUI ever editing a task file, calling Git, or spawning a process directly.

## Why Now
Waves 1–4 (TASK-2282 through TASK-2306) delivered a navigable, attention-ranked, strictly read-only board. TASK-2306 is completed. Wave 5 is the only wave in the seven-wave sequence that can cause an effect, and it must be deliberately isolated: the TUI now submits `BoardCommandRequest` values to the `BoardCommandController` and renders the returned outcome. Only `active:execute` is currently integrated; all other actions render their documented unavailable reason (`UNAVAILABLE_CAPABILITIES`) rather than a dead or lying button. This wave establishes the guarded dispatch path that waves 6 (analytics) and 7 (default invocation) depend on.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: new Ink components (action bar, confirmation dialog, outcome banner), TUI→controller wiring in shell.tsx, progress/operation log rendering, guardrail test, PTY smoke test expansion; all building on the existing `BoardCommandController` and `BoardCommandRequest`/`BoardCommandResult` contracts

## Scope
- **Action bar component** (`src/interfaces/tui/action-bar.tsx`): renders `availableActions` from `BoardProjection` plus the controller's `INTEGRATED_CAPABILITIES` registry; enabled actions are dispatchable, disabled actions show their documented unavailable reason and cannot be dispatched
- **Confirmation dialog** (`src/interfaces/tui/confirmation-dialog.tsx`): for consequential actions (currently `active:execute`), displays the exact application command and requires explicit keypress confirmation; cancelling dispatches nothing
- **Shell wiring** (`src/interfaces/tui/shell.tsx`): replaces the wave-5 placeholder message with actual command dispatch through `BoardCommandController`; on Enter for a selected mission, triggers the action flow (confirmation → dispatch → outcome)
- **Outcome rendering** (`src/interfaces/tui/outcome-banner.tsx`): renders `completed`, `rejected`, `failed`, and `cancelled` outcomes distinctly with operator-safe messages; no failure renders as a completed board move
- **Stale-state conflict handling**: on `conflict` error kind, refreshes the projection and re-presents the action instead of retrying blindly
- **Cooperative cancellation**: cancellation before dispatch returns `cancelled` outcome; cancellation after safe boundary reports durable partial state and directs the operator to re-query, never claiming a rollback that did not occur
- **Progress event and operation log rendering**: progress events from the controller's `ProgressPort` are appended to `BoardProjection.operationLog` and rendered as ordered diagnostic/attention data in the command log area
- **Guardrail test** (`test/tui-command-guardrail.test.ts`): proves `src/interfaces/tui/` modules perform no task-file write, Git call, SQL, Forgejo call, or subprocess spawn
- **PTY smoke test expansion** (`test/tui-pty-smoke.test.ts`): covers one harmless read-only action, one confirmation cancellation, and clean exit, launching no real agent
- **Component tests** (`test/tui-action-bar.test.ts`, `test/tui-confirmation.test.ts`, `test/tui-outcome-banner.test.ts`): mock application ports and execute no real workflow commands

## Out of Scope
- Adding new use cases to the `BoardCommandController` or integrating capabilities beyond `active:execute`
- Drag/drop actions (deferred to a later wave)
- Analytics rendering (wave 6 / TASK-2308)
- Default invocation behavior (wave 7 / TASK-2309)
- Modifying the `BoardCommandController`'s core dispatch logic or the `BoardCommandRequest`/`BoardCommandResult` contracts
- Modifying the `ActiveService` or `ActivePort` implementations
- Web transport integration
- Forgejo PR interaction from the TUI

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: The action bar renders all 8 `BoardCommandKind` values for the selected mission; `active:execute` renders as enabled, the other 7 render as disabled with their exact `UNAVAILABLE_CAPABILITIES` reason string
- SC2: Only commands with `isIntegratedCapability(kind) === true` can be dispatched; dispatching a disabled command is impossible (no dispatch call is made)
- SC3: The `active:execute` action displays the exact application command text and requires an explicit keypress confirmation before dispatch; cancelling the confirmation produces no dispatch call and no state change
- SC4: The TUI dispatches exclusively through `BoardCommandController.dispatch()` or `dispatchWithStatus()`; a guardrail test asserts that no file under `src/interfaces/tui/` imports `node:fs` (write), `node:child_process`, `git`, `sqlite`, or Forgejo clients, and no file writes to `backlog/tasks/`
- SC5: A stale-state conflict result (error kind `conflict`) triggers a projection refresh and re-presents the action; a test covers the scenario where mission status changes between request and dispatch
- SC6: Cancellation before dispatch returns `cancelled` outcome with `error.kind === 'cancelled'`; cancellation after a safe boundary reports durable partial state with `durableEvidence` array and directs the operator to re-query, never reporting a rollback
- SC7: The four outcome states (`completed`, `rejected`, `failed`, `cancelled`) render with distinct visual indicators (color or icon) and the operator-safe error message; `rejected` and `failed` outcomes never render with the `completed` indicator
- SC8: Progress events from the controller's `ProgressPort` are appended to `BoardProjection.operationLog` and rendered in the command log area; a test proves a progress event alone never changes a card's lane
- SC9: The PTY smoke test covers one read-only action dispatch, one confirmation cancellation, and clean exit with exit code 0, launching no real agent
- SC10: Component and controller-integration tests mock application ports (`ActivePort`, `ProgressPort`) and execute no real workflow commands; `./scripts/verify-local.sh all` passes and `./scripts/verify-local.sh static-analysis` passes on the changed `src/` code

## Risks and Assumptions
- **Risk: Ink state management for multi-step flows.** The confirmation dialog requires managing a transient overlay state without blocking keyboard navigation of the board. Mitigation: use a dedicated React state flag in `shell.tsx` that gates the key handler to confirmation keys only while active.
- **Risk: Stale-state detection requires real-time projection refresh.** The TUI must rebuild the `BoardProjection` after a `conflict` result. Mitigation: the shell already has the projection builder wired through `ui-command.ts`; re-invoke the builder's `build()` on conflict.
- **Risk: Progress event ordering.** If the `ProgressPort` callback fires asynchronously, events may arrive out of order in the render. Mitigation: the controller already emits monotonically increasing sequence numbers (verified by existing `board-controller.test.ts`); the TUI renders using `sequence` order.
- **Assumption: `BoardCommandController` is stable.** Its `dispatch()` and `dispatchWithStatus()` methods and the `BoardCommandRequest`/`BoardCommandResult` contracts are not modified by this mission.
- **Assumption: `BoardProjection.availableActions` is populated.** The projection builder must supply `CommandAvailability[]` per mission; the existing `availableBoardCommands()` function in `mission-board.ts` provides this.
- **Assumption: PTY smoke harness is reliable.** The existing `launchPtySmoke()` harness (`test/helpers/pty-smoke-harness.ts`) works for action dispatch interactions (send keypress, wait for render, verify output).

## Checkpoints
- CP 1: Action bar component, confirmation dialog, and outcome banner — unit tests with mocked projection data; components render correct enabled/disabled states, confirmation prompt, and distinct outcome indicators
- CP 2: Shell wiring and command dispatch — `shell.tsx` replaced wave-5 placeholder with `BoardCommandController` integration; confirmation flow → dispatch → outcome rendering; stale-state conflict refreshes projection; guardrail test proves TUI modules perform no direct effects
- CP 3: Progress/operation log rendering and PTY smoke test — progress events appended to `operationLog` and rendered; PTY smoke test covers read-only action, confirmation cancellation, and clean exit

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/interfaces/tui/action-bar.tsx:42` (must point to an existing file and line)
  2. **Test names** — e.g., `"action bar renders active:execute as enabled"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/tui-action-bar.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0051` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `node --import tsx test/tui-action-bar.test.ts` ``, or `` `npm run build` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Action bar renders availableActions | `src/interfaces/tui/action-bar.tsx:15`, `test/tui-action-bar.test.ts`, `"renders enabled action for active:execute"` | PASS |
| Confirmation dialog requires explicit keypress | `src/interfaces/tui/confirmation-dialog.tsx:30`, `test/tui-confirmation.test.ts`, `"cancels dispatch on Escape keypress"` | PASS |
| Guardrail: no direct TUI effects | `test/tui-command-guardrail.test.ts`, `"TUI modules perform no task-file write, Git call, or subprocess spawn"` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas
- `src/application/controller/board-controller.ts` — core dispatch logic is not modified
- `src/application/controller/board-command.ts` — `BoardCommandRequest`, `BoardCommandResult`, `BoardCommandKind`, `BoardCancellation`, `OperationEvent` contracts are not modified
- `src/platform/runtime/lib/application/contracts.ts` — `ApplicationOutcome`, `ApplicationError`, `ProgressEvent`, `DurableEvidence` types are not modified
- `src/platform/runtime/lib/application/active-service.ts` — service logic is not modified
- `src/application/projections/mission-board.ts` — `availableBoardCommands()` and `CommandAvailability` are used as-is
- `test/helpers/pty-smoke-harness.ts` — harness infrastructure is not modified
- `src/application/projections/board.ts` — `BoardProjection` interface is not extended; `operationLog` field is used as-is
- `lib/` directory — no changes to existing `lib/` modules

## Stop Rules
- If `BoardCommandController.dispatch()` or `dispatchWithStatus()` signatures change, stop and raise a design question before adapting the TUI
- If integrating a new capability beyond `active:execute` is needed, stop — that is separate extraction work
- If the `BoardProjection` interface requires new fields for action state, stop and raise a design question
- If the PTY smoke harness fails on non-action interactions (e.g., basic keyboard navigation), stop — that is a wave-3 regression, not a wave-5 issue
- If the scope exceeds 235 NEL, stop and split into two missions (components vs. integration)

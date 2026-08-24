# Mission: Make active-work status truthful and visible (task-2399)

## Goal
Make the status board show reliable information for active agents: retain the working-agent counts, remove fabricated trailing activity text, remove the unrequested “Working” label, and give running mission cards a visible activity animation.

## Why Now
The board currently gets the important fact right—an agent is active—but pairs it with text that was not derived from real state. That makes a live operational view misleading precisely when users rely on it to decide whether work is progressing.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: existing mission-activity projection and its focused renderer test already centralize the affected status output; the requested board treatment is limited to the active/running state.

## Scope
- Trace the `MissionActivity` projection through the status/board renderers to identify the source of the trailing agent text and the “Working” label.
- Preserve the existing active-agent availability/count signal while removing text that cannot be grounded in current mission state.
- Render active/running mission cards with a restrained terminal-compatible animation that communicates activity without adding a new status category.
- Extend `test/mission-activity.test.ts` with deterministic coverage for the changed rendered output and active-card treatment.

## Out of Scope
- Changing how agent availability, worktree discovery, backlog state, or mission activity is computed.
- Showing a `px` command, a live command transcript, or a new blocking-message model.
- Redesigning inactive, completed, blocked, or review mission cards.
- Adding dependencies or a general-purpose animation framework.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- When a mission has active agents, the rendered board/status output retains the existing active-agent number while omitting the fabricated text that follows the agent information.
- The literal unrequested “Working” status text is absent from the rendered active mission-card output.
- A card projected as active/running has a terminal-compatible visual activity treatment; cards outside that state do not receive that treatment.
- `test/mission-activity.test.ts` contains deterministic assertions covering the active-agent output, removal of the fabricated/“Working” text, and the active-only visual treatment.
- `./scripts/verify-local.sh all` completes successfully on the final tree.

## Risks and Assumptions
- Assumption: the existing `MissionActivity` and mission-board projections expose enough state to distinguish active/running cards without changing domain data.
- Risk: ANSI animation can make snapshot-like assertions brittle; tests must assert stable escape-sequence structure or normalized output rather than timing.
- Risk: status rendering is reused outside the board; preserve its count semantics and cover the shared rendering path before changing presentation.

## Checkpoints
- CP 1: Trace `MissionActivity`, `projectMissionCard()`, and `renderStatus()` to document the single shared source of the fabricated trailing text and the active-card state used for presentation. Add focused, deterministic failing-or-baseline assertions in `test/mission-activity.test.ts` for the requested output contract before changing renderer behavior.
- CP 2: Make the smallest shared projection/rendering change that removes fabricated text and the “Working” label, preserves the agent count, and adds the active-only terminal animation. Update the focused test assertions.
- CP 3: Run the repository verification gate and record the final Goal Check evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST lead its evidence with durable references Parallix verifies today: the exact focused test names in `test/mission-activity.test.ts`, that test-file path, recognized commands such as `npm test -- test/mission-activity.test.ts` and `./scripts/verify-local.sh all`, and any applicable ADR reference. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, with at least one durable evidence row for every success criterion.
- A non-generic `Next action:` line at the bottom.

Raw `stat`/`ls` output or generic prose alone is not evidence; if included, pair it with one of the accepted test names, ADR references, test file paths, or recognized repository commands/paths above.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Active-agent count remains and fabricated text is absent | `test/mission-activity.test.ts`, exact test name | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not alter domain agent-family definitions, worktree discovery, Forgejo integration, backlog persistence, or mission lifecycle transitions unless the traced shared renderer proves a change is unavoidable.
- Do not add packages, change the command-line interface, or introduce a live-command/blocking-message feed.
- Keep changes limited to the mission-activity/status/board presentation path and its focused tests.

## Stop Rules
- Stop and request refinement if the requested animation requires a timer, terminal capability negotiation, persistent UI state, or a new dependency rather than existing renderer capabilities.
- Stop and request refinement if tracing shows the agent count and fabricated trailing text are produced by separate consumers with conflicting required output contracts.
- Stop if removing “Working” would remove a distinct, state-derived blocked or review indicator rather than only the unrequested active-card label.

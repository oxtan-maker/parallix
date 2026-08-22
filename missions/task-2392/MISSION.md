# Mission: Active tasks render in the active board lane (task-2392)

## Goal
Ensure every mission whose authoritative lifecycle status is `active` is rendered only in the ACTIVE board lane, never in BACKLOG.

## Why Now
The captured `px board parallix` output places active work, including `task-2268`, in the BACKLOG lane. That makes the operator’s queue inaccurate and can hide real WIP while overstating intake.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one lifecycle-materialization correction and a focused board-projection regression test

## Scope
- Trace the production board read from task lifecycle state through `ConcreteMissionReadAdapter`, `materializeBacklogMission`, `BoardProjectionBuilder`, and `buildBoardProjection` to correct the shared source of the wrong lane assignment.
- Keep lifecycle ownership on the authoritative integration-base task state while allowing only descriptive worktree fields already permitted by `materializeBacklogMission`.
- Add a focused regression test under `test/` that constructs an authoritative `active` mission and verifies the built board projection contains its card in ACTIVE and not BACKLOG.

Reproduction-Test: test/task-2392-active-lane-repro.test.ts

## Out of Scope
- Changing the six board lane names, order, layout, card styling, scrolling, WIP limits, or attention ranking.
- Changing lifecycle transition commands, Backlog task status vocabulary, SQLite schema/migrations, or historical metrics.
- Repairing individual task files or manually moving cards between lanes.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: Given an authoritative task lifecycle status of `active`, the materialized `Mission.status` is `active` even when a mission-worktree copy supplies different descriptive fields.
- SC2: A board projection built with that mission has exactly one card with that mission ID in the ACTIVE stage and zero cards with that ID in the BACKLOG stage.
- SC3: The production board composition continues to derive stage membership from `MissionCard.lane`; no TUI component introduces a second lifecycle-to-lane mapping.
- SC4: `test/task-2392-active-lane-repro.test.ts` fails against the mission parent commit for the captured wrong-lane scenario and passes after the correction.
- SC5: `./scripts/verify-local.sh all` passes on the final tree.

## Risks and Assumptions
- Risk: the captured display may originate before the projection pipeline, so a presentation-only patch could conceal rather than fix the lifecycle disagreement. Mitigation: make the reproduction test exercise the production materialization and board-projection boundary.
- Risk: mission worktrees intentionally contribute fresher descriptive fields. Assumption: their status and assignee must not override the authoritative integration-base lifecycle fields, as encoded by `materializeBacklogMission`.
- Assumption: `BoardProjectionBuilder` remains the single source for board stages; the TUI only renders the supplied stages.

## Checkpoints
- CP 1: Author the failing reproduction test `test/task-2392-active-lane-repro.test.ts` before writing a fix. Name the test `task-2392: active task appears in active stage, not backlog`; create the captured scenario with an authoritative active lifecycle record and any differing mission-worktree descriptive record needed to reproduce the BACKLOG placement; assert the target ID appears once in ACTIVE and never in BACKLOG. It must fail on this mission’s parent commit (red) and pass after the shared correction (green).
- CP 2: Correct the lifecycle materialization or projection seam identified by CP 1 so the authoritative `active` status reaches `MissionCard.lane` unchanged. Do not add a UI-side lane override.
- CP 3: Run the focused reproduction test and the required repository gate; record durable evidence in the checkpoint documents.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column table header `| Criterion | Evidence | Status |`.
- At least one evidence row for every success criterion, led by durable references Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. Use file:line references only when necessary (accepted but discouraged because line numbers rot).
- Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with an accepted reference above.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Active lifecycle appears only in ACTIVE | `test/task-2392-active-lane-repro.test.ts`, `"task-2392: active task appears in active stage, not backlog"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/interfaces/tui/board-layout.tsx`, `src/interfaces/tui/lane-column.tsx`, and `src/interfaces/tui/mission-card.tsx` — presentation consumers must not be used to remap lifecycle state.
- `src/adapters/backlog/task-transitions.ts` — lifecycle writes are outside this read/projection correction unless CP 1 proves the authoritative status is written incorrectly.
- `src/adapters/sqlite/migrations/` and `src/adapters/sqlite/mission-store.ts` — no storage schema or aggregate migration belongs in this small regression fix.

## Stop Rules
- Stop and report if the red reproduction cannot be produced through the authoritative materialization and board-projection path; do not guess with a UI-only patch.
- Stop and request a split if correcting the defect requires changing lifecycle storage, transition semantics, or more than the focused projection/materialization seam.
- Do not alter task status, assignee, or labels for unrelated missions to make the board appear correct.

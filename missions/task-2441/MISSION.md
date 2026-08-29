# Mission: Restore mission titles in the Ink board (task-2441)

## Goal
Restore the mission title shown on each mission card in the Ink board so active, review, integration, and done cards display the task's actual title instead of the literal `<Title>` placeholder.

## Why Now
The board currently hides the identifying text users need to distinguish missions at a glance. The regression affects every displayed lane, making the terminal UI materially less useful during normal workflow monitoring.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: a visible cross-lane TUI regression; existing FlowPanel rendering and focused TUI tests provide a narrow repair surface.

## Scope
- Add a focused regression test at `test/task-2441-mission-title-repro.test.ts` that renders board data containing a non-placeholder mission title.
- Trace the board projection into `src/interfaces/tui/flow-panel.tsx` and repair the shared title-rendering path used by mission cards.
- Preserve the existing task slug, labels, workflow status, checkpoint text, and lane layout while restoring the title text.

## Out of Scope
- Changing board lane selection, ordering, metrics, wrapping policy, colors, or terminal-width layout.
- Altering mission metadata schemas, backlog parsing, or workflow state transitions.
- Reworking unrelated TUI components or adding a new rendering abstraction.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The focused reproduction renders a mission whose source title is `Restore title visibility` and asserts that exact title is present in the rendered Ink output.
- The same reproduction fails against the mission parent commit because the output contains `<Title>` rather than the supplied title, then passes after the repair.
- Mission cards in active, review, integration, and done use the shared repaired title path; their existing slug, labels, status, and checkpoint/next-action content remain rendered.
- `./scripts/verify-local.sh all` succeeds on the completed mission tree.

## Risks and Assumptions
- Assumption: mission title data is already available to the board projection and is lost or replaced only while formatting FlowPanel card content.
- Risk: terminal-width truncation could conceal a long title; this mission requires restoration of the title value, not a new overflow policy.
- Risk: one lane may format card content differently; the reproduction and implementation must cover the common card path across all four lanes.

## Checkpoints
- CP 1: Write `test/task-2441-mission-title-repro.test.ts` before any production change. Render representative board data for active, review, integration, and done with a mission title of `Restore title visibility`; assert the rendered output contains that exact title and does not use `<Title>` for the card title. The assertion must be red at the mission parent commit and green after the repair.
- CP 2: Trace title data from `src/application/projections/board.ts` through `src/interfaces/tui/flow-panel.tsx`, make the smallest shared rendering repair, and retain the card's existing metadata fields.
- CP 3: Run the declared verification gate and record the final Goal Check evidence.

Reproduction-Test: test/task-2441-mission-title-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Durable evidence first: cite exact test names, ADR references, test file paths such as `test/task-2441-mission-title-repro.test.ts`, and recognized repository commands/paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./scripts/verify-local.sh all`. File:line references are accepted parenthetically when needed but discouraged because line numbers rot.
- The exact heading `## Goal Check`.
- The exact three-column table header `| Criterion | Evidence | Status |`, with one evidence row for every success criterion.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with an accepted reference above.
- A concise summary of work done and a non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify workflow state handling, mission/backlog schemas, or board metric calculations to repair this display regression.
- Do not change generated `.test-runtime/` artifacts directly; update source and test inputs only during execution.
- Do not broaden the repair beyond the board projection and FlowPanel title presentation without evidence that the title is lost earlier in the data flow.

## Stop Rules
- Stop and report if the title is absent from `src/application/projections/board.ts`; expanding into mission metadata loading requires explicit scope confirmation.
- Stop and report if restoring the title requires a terminal layout, text-wrapping, or schema redesign rather than a localized rendering correction.
- Stop and report if the red reproduction cannot be made deterministic using mocked board data under `test/`.

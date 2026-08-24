# Mission: Remove hallucinated board content (task-2408)

## Goal
Make `px board` show only the attention rail's supported content and prevent raw persisted agent-block payloads from being rendered in the agent strip.

## Why Now
The board currently renders a count and active-work rows above `▲ NEEDS YOU NEXT`, even though that rail is defined for attention items. It also renders an unbounded stored block reason, allowing a raw quota-matching regular expression to leak into the operator view. Both make the board report invented or internal content as operator-facing state.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one TUI rail composition removal, one boundary for agent-block display text, and a focused Ink render regression test.

## Scope
- Add `test/task-2408-board-hallucinated-content-repro.test.ts`, rendering a board with live mission work and an unavailable agent whose stored reason is the reported quota regular expression.
- Remove the active-work count and active-work item list from the operator rail so `▲ NEEDS YOU NEXT <count>` is its first rendered content inside that rail.
- Keep authoritative mission-work totals in the agent strip and retain all attention items, attention count, source-status indicators, ranking footer, keyboard behavior, and board lanes.
- Do not render raw persisted agent-block payload text; retain the availability state, countdown when applicable, and family-specific `px cmd` evidence.

## Out of Scope
- Changing attention ranking, attention eligibility, mission activity projection, agent-block persistence format, quota detection rules, or process-liveness collection.
- Changing board commands, lifecycle transitions, lane/card layout, or `px status` wording.
- Adding new metrics, configuration, dependencies, or documentation when the existing board documentation already states the retained behavior.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `test/task-2408-board-hallucinated-content-repro.test.ts` is red on the mission parent commit: its rendered rail contains content before `▲ NEEDS YOU NEXT`, and its rendered agent strip contains the injected raw quota regular expression; it is green after the repair.
- In a rendered board with one live mission and one attention item, the rail's first content is exactly `▲ NEEDS YOU NEXT 1`; it contains neither the active-work count nor the live mission's `task-… · phase · agent` row before that heading.
- The same rendered board retains the attention mission, its action text, source-status indicator when supplied, and the `ranked: integrate>review>active` footer after the rail cleanup.
- A stored agent-block reason containing `parsed: (?:\\b429\\b...)` is not rendered; the affected family still renders as unavailable with any applicable countdown and its `px cmd` liveness text.
- `./scripts/verify-local.sh all` exits successfully on the final tree.

## Risks and Assumptions
- Risk: deleting the rail's active-work rendering could accidentally remove the separately supported agent-strip activity summary. Mitigation: the reproduction renders live work and asserts the `work:` summary remains while the rail begins with its heading.
- Risk: broadly sanitizing block reasons could hide legitimate operator explanations. Mitigation: limit the change to rejecting or replacing internal/raw payload forms at the display boundary; retain normal concise launcher and block reasons.
- Assumption: `src/interfaces/tui/shell.tsx` owns the unsupported rail content and `src/interfaces/tui/agent-strip.tsx` is the display boundary through which the raw reason reaches the UI.

## Checkpoints
- CP 1: Before any fix, author `test/task-2408-board-hallucinated-content-repro.test.ts`. Render the board with one live-work card, one attention item, and an unavailable agent whose reason is `parsed: (?:\\b429\\b...)`; assert that the rail begins with `▲ NEEDS YOU NEXT 1` and that the raw reason is absent. On the mission parent commit both assertions fail (red); after the repair both pass (green).

Reproduction-Test: test/task-2408-board-hallucinated-content-repro.test.ts

- CP 2: Trace every render caller for the operator rail and agent availability reason, then make the smallest display-boundary change that removes only unsupported rail content and raw payload leakage while preserving supported work, attention, and availability facts.
- CP 3: Run the focused reproduction and the repository gate; inspect the final diff for scope compliance and record the Goal Check evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Lead every evidence row with durable evidence Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted parenthetically when needed, but discouraged because line numbers rot.
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |` and at least one evidence row for every Success Criterion.
- Cite `test/task-2408-board-hallucinated-content-repro.test.ts` and its exact red/green test name for the regression criterion; cite `test/tui-wave-4-attention.test.ts` or its exact retained-behavior test names when using existing attention coverage; cite `./scripts/verify-local.sh all` for the final gate.
- Raw `stat`/`ls` output or generic prose alone is not enough; if included, pair shell output with an accepted reference above.
- A non-generic `Next action:` line at the bottom that names the next scoped render boundary or verification command.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change `src/application/projections/mission-activity.ts`, attention ranking/projection code, agent-block persistence, telemetry probes, or `px status` unless tracing proves the TUI display boundary cannot own the repair.
- Do not remove the agent-strip `work:` summary, attention action text, source-status indicators, ranking footer, or per-family `px cmd` liveness evidence.
- Do not add a general-purpose content filter, a new configuration setting, or a dependency for this presentation defect.

## Stop Rules
- Stop and report if the proposed reproduction cannot fail on the mission parent commit using only an Ink render and deterministic fixtures.
- Stop and request direction if preventing the raw reason leak requires changing persisted agent-block data, quota detection, or the shared `px status` vocabulary.
- Stop and report if removing pre-heading rail content makes the supported agent-strip work summary or attention navigation unavailable.
- Stop and report if `./scripts/verify-local.sh all` fails for an unrelated pre-existing failure that cannot be separated from this mission.

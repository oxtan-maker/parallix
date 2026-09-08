# Mission: Web design tweaks (task-2469)

## Goal
Polish the mission dashboard presentation: show Flow values without decimal places, remove the redundant command-session phrase from running-agent summaries, and restore the missions-per-week attention copy after the WIP-5 indicator.

## Why Now
The dashboard currently exposes unnecessary precision and noisy agent status text, while a useful throughput/attention cue is absent. These are visible presentation regressions in a frequently used operational view.

## Refinement Signals
- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: three isolated dashboard-copy/formatting corrections; no data-model or workflow behavior change expected

## Scope
- Format every numeric value rendered in the Flow section with zero decimal places.
- Render running-agent summaries without command-session counts (for example, `● codex 0`, not `● codex 0 command sessions`).
- Restore the missions-per-week and attention text immediately after the WIP-5 indicator using the existing dashboard data source.
- Add or adjust focused automated coverage for the three rendered behaviors.

## Out of Scope
- Changing Flow calculations, source data, aggregation intervals, or mission-state semantics.
- Changing agent lifecycle, command-session tracking, or persistence.
- General dashboard redesign, new metrics, accessibility redesign, or copy changes outside the specified UI strings.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The Flow section renders all displayed numeric values as whole-number strings; no Flow value includes a decimal separator.
- Each running-agent summary omits the words `command session` and `command sessions` while retaining the agent name and its displayed count.
- The dashboard displays `missions/wk after wip 5 · attention` with values supplied by the existing dashboard model, after the WIP-5 indicator.
- Focused automated tests cover the whole-number Flow formatting, command-session omission, and restored throughput/attention text.
- `./scripts/verify-local.sh all` exits successfully on the final tree.

## Risks and Assumptions
- Assumption: Flow and throughput/attention values are already available to the dashboard presentation layer; this mission must not add a new data source.
- Risk: changing a shared number formatter could alter unrelated dashboard values; constrain the formatting to the Flow rendering path unless existing tests establish a shared display contract.
- Risk: singular/plural command-session variants may be emitted by different agent states; coverage must exercise both strings or the shared formatter that removes them.

## Checkpoints
- CP 1: Locate the existing Flow, running-agent, and WIP/attention rendering paths and their focused tests; record the current render contracts and the smallest shared presentation point for each correction.
- CP 2: Implement the three scoped presentation corrections and add focused regression coverage for whole-number Flow values, command-session omission, and restored missions-per-week/attention text.
- CP 3: Run the required verification gate and complete the Goal Check with durable evidence for every success criterion.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Durable evidence first: cite exact test names, ADR references, test file paths, or recognized repository commands/paths such as `npm ...`, `node ...`, `git ...`, `px ...`, and `./...`. File:line references are accepted parenthetically but discouraged because line numbers rot.
- A summary of work done.
- The exact heading `## Goal Check`.
- A 3-column pipe-delimited Markdown table with exactly `| Criterion | Evidence | Status |` as its header and at least one evidence row for every success criterion.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with an accepted durable reference above.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not alter domain models, mission workflow rules, persistence schemas, or agent execution/session behavior.
- Do not modify dashboard data calculations or introduce dependencies; limit changes to the existing presentation and its focused tests.
- Do not change backlog-task ownership or task status during execution.

## Stop Rules
- Stop and request direction if the requested text requires a new metric, query, API, or persisted field rather than existing dashboard data.
- Stop and request direction if whole-number Flow rendering conflicts with an established product requirement to preserve fractional precision.
- Stop and request direction if removing command-session wording requires changing agent/session semantics rather than display formatting.

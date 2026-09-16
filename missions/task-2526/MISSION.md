# Mission: Render descriptive mission summaries on the web (task-2526)

## Goal
Make web mission summaries display the mission's human-readable description rather than the YAML folded-scalar marker (`>-`).

## Why Now
Mission cards that show `>-` conceal the work's purpose, so people using the web interface cannot distinguish missions without opening their source documents.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: isolate the summary extraction/normalization boundary, lock the reported YAML formatting regression, and preserve valid descriptive summaries.

## Scope
- Add a regression test under `test/` that reproduces a mission description serialized as a YAML folded scalar and proves the current web summary becomes `>-` at the parent commit.
- Trace the data path used by the web mission card/list summary and correct its parsing or normalization so folded-scalar mission descriptions render as their descriptive text.
- Preserve the existing display of ordinary mission descriptions and the existing mission-card data contract.

## Out of Scope
- Redesigning mission cards, changing their layout, or adding new mission metadata.
- Reformatting existing mission or backlog Markdown/YAML files solely to avoid the parser behavior.
- Changing summaries outside the web mission presentation path.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A mission whose `Description` section is represented by YAML as a folded scalar is projected to the web with its descriptive text, not the literal string `>-`.
- The regression test named `web mission summary renders folded YAML description text` fails against the mission parent commit and passes after the correction.
- A test case for an ordinary mission description continues to assert its existing summary text unchanged.
- `./scripts/verify-local.sh all` exits successfully on the final tree.

## Risks and Assumptions
- Assumption: `>-` originates from a supported YAML serialization shape, not intentional mission content.
- Risk: summary extraction may be shared with non-web projections; inspect all callers before changing a shared parser or adapter.
- Risk: descriptions can be absent or whitespace-only; retain the current fallback behavior for those cases.

## Checkpoints
- CP 1: Author `test/task-2526-web-summary-repro.test.ts` before the fix. It must construct or load a mission whose description serializes as a YAML folded scalar, exercise the web-summary projection, and assert the rendered summary equals the description text rather than `>-`. Confirm the test is red at the mission parent commit, then retain it as the green regression test after implementation.
Reproduction-Test: test/task-2526-web-summary-repro.test.ts
- CP 2: Trace the mission-description-to-web-summary path, implement the smallest shared-boundary correction, and extend coverage for an ordinary description plus empty/whitespace fallback only if that behavior is affected.
- CP 3: Run the required verification gate and record durable evidence for every success criterion.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A concise summary of the work completed in that checkpoint.
- The exact heading `## Goal Check`.
- The exact 3-column table header `| Criterion | Evidence | Status |`, with one row for every success criterion.
- Durable evidence first: the exact test name `web mission summary renders folded YAML description text`, its test file path `test/task-2526-web-summary-repro.test.ts`, any applicable ADR reference, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./scripts/verify-local.sh all`. File:line references are accepted when needed but discouraged because line numbers rot.
- Raw `stat`/`ls` output or generic prose alone is not evidence: pair any shell output with an accepted test name, ADR reference, test path, or recognized repository command/path above.
- A non-generic `Next action:` line at the bottom; CP 1 must state whether the reproduction test is red at the parent commit, and later checkpoints must state its green result.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Folded description renders text | `test/task-2526-web-summary-repro.test.ts`, `"web mission summary renders folded YAML description text"` | PASS |
| Final verifier completed | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change the mission YAML/Markdown authoring format, backlog task schemas, or web-card layout unless the traced summary boundary makes it unavoidable.
- Do not alter unrelated mission projections or summary consumers without a regression test proving they share the faulty boundary.

## Stop Rules
- Stop and request direction if `>-` is intentional literal mission content rather than a serialization artifact.
- Stop and request direction if correcting the web summary requires a schema migration, bulk rewrite of existing missions, or a web-card redesign.
- Stop if the red reproduction cannot be isolated to the web summary path; report the traced inputs and observed output instead of broadening the change speculatively.

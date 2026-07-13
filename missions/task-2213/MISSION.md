# Mission: Correct weekly review-stat aggregation (task-2213)

## Goal
Make the weekly “Agent performance” review-stat report classify only completed missions by their model-level agent row (falling back to the recorded implementer when no model is recorded) and calculate each agent row’s average review-fix rounds from those same missions.

## Why Now
The current weekly table reports misleading implementation and review-quality data. Decisions based on those rows are unreliable when a mission is attributed to the wrong agent row or its review rounds are included in another row’s average.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: correct completed-mission filtering, model-level row attribution (with implementer fallback), and per-model review-round averaging in the weekly review-stat report.

## Scope
- Locate the report’s completed-mission data selection and aggregation path.
- Define and test the mapping from a completed mission’s recorded model (with implementer fallback) to the agent row shown in the weekly table.
- Compute each row’s mission count and average PR fix rounds from the identical completed-mission subset assigned to that row.
- Preserve the report’s existing weekly date window and table columns while correcting their values.

## Out of Scope
- Changing who owns or implements missions.
- Changing review-round creation, PR repair workflow, or historical mission records.
- Adding new report columns, new time windows, dashboards, or external analytics exports.
- Reclassifying models beyond the model/implementer attribution rules already represented by mission metadata.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A completed mission contributes to exactly one agent row, keyed by its recorded model (falling back to the recorded implementer, and to `unknown` when both are absent), and contributes to no row when it is outside the selected weekly date window.
- The displayed mission count for every agent row equals the number of completed missions assigned to that row in the selected window.
- The displayed average PR fix rounds for every agent row is calculated solely from the completed missions counted in that row; missions assigned to another row cannot affect it.
- The report preserves rows for models represented by completed missions with zero review-fix rounds and renders their average as `0.00`.
- A regression test reproduces the reported cross-row/counting error at the parent commit and passes after the correction, without focused (`.only`) or unannotated skipped tests.

## Risks and Assumptions
- Assumption: completed-mission metadata contains a reliable model or implementer identity and review-fix-round value for reportable missions.
- Risk: legacy metadata may use model identifiers that require normalization to the displayed row labels; the implementation must use the report’s established normalization policy rather than inventing new labels.
- Risk: missions with missing model/implementer or review-round metadata can silently skew totals; their handling must be explicit and covered by tests.
- Risk: the report may share aggregation helpers with other statistics; changes must not alter unrelated report sections.

## Checkpoints
- CP 1: Author a failing regression reproduction at `test/review-stats.test.js` before changing production code. Create completed missions in the same weekly window for at least two models with distinct review-fix-round values, then assert each table row has its own model’s count and average. The assertion must fail on this mission’s parent commit (red) and pass after the correction (green).
- CP 2: Correct the report’s completed-mission selection, model-level row grouping (with implementer fallback), and review-round aggregation so the CP 1 reproduction passes. Add focused coverage for an in-window completed mission with zero review-fix rounds and an out-of-window or non-completed mission that must not affect a row.
- CP 3: Run the required local verification gate, inspect the resulting weekly table through the tested report path, and capture exact test names plus file:line evidence in the final checkpoint.

Reproduction-Test: test/review-stats.test.js

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited markdown table `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/review-stats.test.js` ``, `` `node ...` ``, `` `git ...` ``, `` `px ...` ``, or `` `./scripts/verify-local.sh all` ``
- Weak-agent failure mode: raw `stat`/`ls` output or generic prose alone is not evidence; when shell output is useful, pair it with an accepted file:line reference, exact test name, ADR reference, test file path, or recognized repo command/path above.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Each agent row uses only its completed missions | `test/review-stats.test.js`, exact regression-test name | PASS |
| Review-round average excludes other rows | report aggregation file:line and exact test name | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all` passes on the final tree.
- [ ] The CP 1 reproduction is demonstrated red against the parent commit and green after the correction.
- [ ] Relevant report tests run without `.only` or unannotated `.skip` additions.

## Restricted Areas
- Do not change mission ownership metadata, review workflow behavior, or historical mission data to make the statistics appear correct.
- Do not change report columns, the weekly date-window definition, or unrelated statistics unless required to keep the corrected aggregation internally consistent.
- Keep the fix confined to the review-stat reporting path and its tests; do not refactor unrelated reporting infrastructure.

## Stop Rules
- Stop and request direction if completed missions do not expose a recorded model or implementer, or a review-fix-round source, sufficient to define deterministic attribution.
- Stop and request direction if the desired row-label normalization policy conflicts with existing report labels or requires reclassifying historical records.
- Stop and request direction if correcting the aggregation necessarily changes the weekly date-window semantics or another report’s documented output.

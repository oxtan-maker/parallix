# Mission: Ink TUI wave 6 flow analytics panel (task-2308)

## Goal
Deliver the Ink FLOW panel backed by `BoardMetrics`: cumulative flow, per-state median cycle time, weekly throughput, review-to-active loop rate, per-lane median age, agent availability, and a projection-derived bottleneck narrative. The panel must show declared missing-history fallbacks without fabricating data and remain legible in narrow or resized terminals.

## Why Now
TASK-2303 provides the typed lane-transition history this panel needs. This is wave 6 of 7 and intentionally follows that write-path work so the UI can consume real history while still handling repositories that have none. Landing the read surface now completes the analytics view before wave 7 changes invocation defaults.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: projection extensions for derived flow data and narrative; Ink component rendering and responsive textual chart fallback; deterministic projection and component tests for history-present and history-missing states.

## Scope
- Extend the application metrics projection rooted at `src/application/projections/metrics.ts` to expose the inputs and derived bottleneck narrative required by the FLOW panel, keeping all metric arithmetic and narrative derivation out of Ink components.
- Render the FLOW panel’s cumulative flow, median cycle time by state, throughput by week, review-to-active loop rate, per-lane median age, agent-availability strip, and bottleneck sentence from `BoardMetrics`.
- Render each declared `missingHistoryFallback` explicitly for incomplete or absent history; support the complete zero-history panel state without a crash.
- Add responsive Ink rendering that uses a legible textual representation when terminal width is narrow or changes after resize.
- Add focused projection and component tests that assert labels and values, including a fixed-data bottleneck sentence, missing/unavailable states, narrow rendering, resize behavior, zero history, headless CLI compatibility, and the non-TTY Ink-isolation path.

## Out of Scope
- Recording lane-transition events, defining the typed event schema, or otherwise changing the TASK-2303 write path.
- New metrics beyond the values and declared fallbacks exposed by `BoardMetrics`.
- Invocation-default changes reserved for wave 7 / TASK-2309.
- Estimating, back-filling, or synthesizing historical metric values.
- Redesigning unrelated board panels or changing non-Ink UI implementations.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The FLOW panel renders cumulative flow, median cycle time per state, weekly throughput, and review-to-active loop rate from `BoardMetrics`; component source contains no arithmetic that derives those metrics.
- For every incomplete-history series exercised by tests, the panel displays that series’ declared `missingHistoryFallback` (`null`, `estimate`, or `skip`) and does not display a substituted historical value.
- The panel renders per-lane median age and agent availability from the projection, including an explicit unavailable agent state.
- The application projection derives the bottleneck narrative from named metric inputs, and a deterministic projection test asserts the exact sentence for a fixed dataset.
- At narrow terminal width and after a width resize, each chart has a legible textual rendering with its value and label available to component tests.
- A repository with zero history renders the entire FLOW panel without throwing and explicitly communicates that history is missing.
- New or updated component tests assert user-visible values and labels rather than relying only on snapshots.
- Headless CLI compatibility and the repository’s non-TTY Ink-isolation test pass after the change.
- `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` complete successfully on the implementation tree.

## Risks and Assumptions
- Assumption: TASK-2303 is available on the integration path and supplies typed lane-transition history; if it is unavailable, preserve explicit missing-history rendering and do not invent values.
- Risk: terminal-width changes can make chart layouts unreadable or cause Ink-specific failures; mitigate with deterministic narrow-width and resize component tests.
- Risk: historical data can be partial or malformed; treat only the projection’s declared fallback as authoritative and cover zero-history behavior.
- Risk: derived narrative wording may drift from its metric inputs; keep its inputs named in the projection and assert an exact fixed-dataset sentence.

## Checkpoints
- CP 1: Inspect `BoardMetrics`, the TASK-2303 history contract, existing Ink panel composition, and relevant tests; document the concrete projection fields, fallback semantics, rendering locations, and test files to change.
- CP 2: Implement and unit-test projection-owned flow-series values, availability state, and bottleneck narrative using deterministic history fixtures, including incomplete and zero-history inputs.
- CP 3: Implement the Ink FLOW panel and responsive textual chart fallback; add component coverage for values, labels, unavailable state, narrow width, resize, zero history, headless CLI, and non-TTY isolation.
- CP 4: Run required verification, complete the Goal Check evidence table, and record any deferred work that belongs to TASK-2303 or TASK-2309.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of the completed projection, Ink rendering, and test work for that checkpoint.
- The exact heading `## Goal Check`.
- This exact 3-column table header: `| Criterion | Evidence | Status |`.
- At least one evidence row for every Success Criterion. Accepted evidence forms are existing file:line references, exact repository test names, ADR references, existing test file paths, and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...` commands.
- For this mission, cite the changed projection and Ink files by file:line, the deterministic bottleneck test by exact test name and test file path, the responsive and zero-history tests by exact test name, and verification with `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis`.
- Raw `stat`/`ls` output or generic prose alone is insufficient evidence. If shell output is included, pair it with an accepted file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path.
- A concrete `Next action:` line at the bottom, such as identifying the next projection field, rendering branch, test case, or verification command to complete.

Use the exact table header above and replace every evidence cell with the real, existing reference produced by that checkpoint; do not use placeholders, prospective test names, or proposed line numbers.

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not modify the typed lane-transition event schema or recording write path owned by TASK-2303.
- Do not add a component-side metric calculation, inferred history, back-filled series value, or estimated substitute for a declared fallback.
- Do not change invocation defaults owned by TASK-2309.
- Keep changes scoped to the application projection, Ink FLOW presentation, directly related tests, and only necessary documentation.

## Stop Rules
- Stop and request direction if TASK-2303’s typed history contract is absent, incompatible with `BoardMetrics`, or requires changes to its event-recording ownership boundary.
- Stop and request direction if a required metric or fallback is not exposed by the projection and defining it would create a new metric rather than present an existing one.
- Stop and request direction if responsive rendering cannot be made legible without changing the shared terminal layout system or another panel outside this mission’s scope.
- Stop and report the failing command and focused evidence if `./scripts/verify-local.sh all` or `./scripts/verify-local.sh static-analysis` fails for changes attributable to this mission.

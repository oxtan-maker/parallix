# Mission: Make statistics provenance and health visible (task-2347.07)

## Goal
Make board statistics explicitly report their data provenance and collection health, so operators can distinguish genuine zero completed missions from unavailable, partial, or pre-lifecycle telemetry.

## Why Now
The board currently converts adapter and recording failures into plausible empty metrics. That can cause experiment decisions to be made from lost or incomplete telemetry, while task-2347.01 supplies the lifecycle history this mission must characterize.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate after TASK-2347.01 is available; the acceptance criteria identify the projection, recorder, and board seams.
- Main drivers: typed metrics provenance, failed-write observability, explicit board health states, sample-size display, and regression coverage.

## Scope
- Add metrics provenance that identifies the repository, evaluated window, sample size, newest event timestamp, rejected or identity-missing row count, and adapter-success state.
- Change `BoardProjectionBuilder.buildMetrics` and its fallback path so a metrics-read adapter failure produces an explicit unavailable state rather than `defaultMetrics` zeros or empty series.
- Distinguish projection output for no completed missions, no telemetry recorded, partial telemetry, and repository history that predates lifecycle recording.
- Count lane-transition recording failures from `recordLaneTransitionSafely` without allowing a failed write to block a board transition.
- Render the statistics health state and the sample size adjacent to every displayed median or rate in the board.
- Add focused unit or component tests for the adapter-failure, provenance, no-completions/no-telemetry, and non-blocking recording-failure cases.

## Out of Scope
- Retrying, alerting on, or automatically repairing failed telemetry writes.
- Changing metric formulas owned by task-2347.03, task-2347.04, or task-2347.06.
- Adding a standalone statistics-health CLI command.
- Backfilling lifecycle events into existing repositories.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A regression test proves that a thrown metrics-read adapter error renders an explicit unavailable statistics state and does not render default-zero median, rate, or empty-series values.
- The metrics projection exposes repository, evaluated window, sample size, newest event timestamp, rejected-or-missing-identity row count, and adapter-success state; a test asserts every field from a controlled history fixture.
- Projection tests assert distinct output states for (a) a repository with completed missions but no recorded telemetry and (b) recorded telemetry with zero completed missions.
- A recorder test forces a lane-event write failure, asserts that the transition still completes, and asserts that the failure counter or equivalent observable health value increments by one.
- Board rendering tests assert that each rendered median or rate is accompanied by its sample size and that unavailable and partial health states are visibly labelled.
- `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` complete successfully on the final tree.

## Risks and Assumptions
- Assumes TASK-2347.01 establishes lifecycle-history records that can identify a repository and event time; if it does not, stop for a contract update rather than fabricate provenance.
- Historical repositories may have valid mission records created before lifecycle recording; the UI must label that state without classifying it as an adapter failure.
- Recording must remain best-effort: new failure accounting must not throw from transition code or create a recursive telemetry path.
- Existing board consumers may destructure the metrics projection; changing its shape needs type and rendering coverage for each consumer.

## Checkpoints
- CP 1: Author `test/task-2347.07-statistics-provenance.repro.test.ts` before any production change. It must configure the metrics-read adapter to throw while the board projection is built, assert the current parent commit renders an explicit unavailable statistics state rather than default zeros, and fail red on the parent commit before passing green with the completed fix.
- CP 2: Define and test the provenance and health contract in the metrics projection: repository, window, sample size, newest event timestamp, rejected-or-missing-identity count, adapter-success state, and distinct no-completions versus no-telemetry outcomes.
- CP 3: Implement non-blocking recording-failure accounting and its observable projection or board-facing health value; test the failed-write count and unchanged transition behavior.
- CP 4: Render unavailable and partial statistics states and sample sizes beside every board median or rate; add rendering coverage for those states.
- CP 5: Run the required verification gates, write checkpoint evidence, and reconcile every success criterion in the final Goal Check.

Reproduction-Test: test/task-2347.07-statistics-provenance.repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST include:
- A concrete summary of the files and behavior changed in that checkpoint.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table `| Criterion | Evidence | Status |`.
- At least one evidence row for every success criterion. Accepted evidence must use a file:line reference, an exact repository test name, an ADR reference, a test file path, or a recognized repository command/path such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- File:line references must point to an existing line; exact test names must match a repository test; ADR references must resolve under `docs/adr/`; and test file paths must exist.
- Raw `stat`/`ls` output or generic prose alone is not evidence. It may be supplemental only when paired with one of the accepted references above.
- A non-generic `Next action:` line at the bottom that names the next file, test, or verification command.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Adapter failure is explicit | `src/application/projections/board-readers.ts:176`, `test/task-2347.07-statistics-provenance.repro.test.ts` | PASS |
| Final verification ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not alter metric formula definitions or formula semantics owned by task-2347.03, task-2347.04, or task-2347.06.
- Do not add telemetry-write retries, alert delivery, a separate health CLI, or lifecycle-history backfills.
- Do not let recording-failure accounting throw, block, or otherwise change a lane transition’s success path.
- Do not present adapter failures as default metrics, empty series, or a genuine zero sample.

## Stop Rules
- Stop and request a contract update if TASK-2347.01 does not provide stable repository and timestamp data needed for the provenance fields.
- Stop if making a health state visible requires changing a metric formula, retry policy, alerting behavior, CLI surface, or historical-data backfill.
- Stop before merging if any success criterion lacks a matching focused test and final Goal Check evidence row.
- Stop and investigate before completion if either required verification gate fails; do not waive failures with prose alone.

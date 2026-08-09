# Mission: Own statistics semantics in one application service (task-2347.08)

## Goal

Make one application-layer statistics service the sole owner of mission identity, completion, windowing, UTC time bucketing, and metric evaluation so that `px stats` and the board report the same figures from the same history.

## Why Now

The CLI and board currently calculate the same mission statistics through separate implementations with incompatible rules. This produces conflicting operational reports and makes every correction a duplicated change. The existing lane-interval work from task-2347.03 also permits the shared evaluator to replace the board's history-rescanning implementation.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: The acceptance criteria identify the duplicated implementations, required semantic rules, regression coverage, and presentation-adapter boundaries.
- Main drivers: extract statistics semantics from the CLI adapter; route board metrics through the shared service; preserve CLI output and flags; lock UTC bucketing and linear evaluation with tests; replace positional board-metrics input with named fields.

## Scope

- Add an application-layer statistics service that defines mission identity by repository plus mission, completion as `closed === 'yes'`, reporting-window membership, UTC-normalized time buckets, and the mission and lane metric series consumed by the CLI and board.
- Make `src/adapters/cli/commands/stats.ts` a presentation adapter over the shared service while retaining its existing report formatting and flags.
- Make `src/application/projections/metrics.ts` and `src/application/projections/metrics-read-adapter.ts` consume the shared statistics semantics rather than independently recreating mission grouping, completion, windowing, or metric calculations.
- Evaluate metric history using ordered passes over transitions, outcomes, and lane intervals rather than rescanning full histories for each output instant.
- Change `buildBoardMetrics` to accept a named-field input and remove its positional overloads and unchecked metric-series casts.
- Add focused tests for CLI/board parity, single ownership of semantic rules, UTC-equivalent offset bucketing, bounded work on synthetic history, named board-metrics input, and the regression reproduction below.

## Out of Scope

- Changing `px stats` output formatting, command flags, or report schema.
- Cohort or experiment comparison work assigned to task-2347.09.
- Rewriting the legacy CSV import path.
- Changing the database schema or historical event data.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- [ ] SC1: A single dataset passed through the CLI report path and the board projection yields identical mission count, completed-mission set, and cycle-time figures.
- [ ] SC2: Mission identity (repository plus mission), completion (`closed === 'yes'`), and reporting-window membership have one production definition in the shared application service; a guard test fails if `src/adapters/cli/commands/stats.ts` reimplements any of those rules.
- [ ] SC3: A timestamp with a non-UTC offset and its UTC-equivalent instant are assigned to the same UTC hour bucket by the shared statistics implementation.
- [ ] SC4: Metric series evaluation processes ordered event history without a per-output-instant rescan; a large synthetic-history test bounds the inspected work and fails for quadratic evaluation.
- [ ] SC5: `buildBoardMetrics` accepts one named-field input; its positional overloads and unchecked `MetricSeries` or `LaneMetricSeries` casts are absent.
- [ ] SC6: The regression test at `test/task-2347.08-own-statistics-semantics-repro.test.ts` is red at this mission's parent commit and green after the shared service routes both consumers through identical semantics.
- [ ] SC7: `./scripts/verify-local.sh all` completes successfully on the final mission tree.

## Risks and Assumptions

- Existing CLI calculations include deliberate distinctions between rollup and stage rows; the extracted service must preserve those distinctions rather than treating all rows as interchangeable.
- Board and CLI callers may currently depend on differently shaped intermediate data; adapters may need explicit mapping while metric definitions remain centralized.
- Synthetic-history work bounds must measure an observable evaluation seam without relying on wall-clock timing.
- Task-2347.03's lane-interval representation is available in this branch and is sufficient for ordered lane metric evaluation.
- The regression reproduction can be isolated with mocked persistence and does not contact Forgejo or invoke external agents.

## Checkpoints

- CP 1: Author `test/task-2347.08-own-statistics-semantics-repro.test.ts` before implementation. Feed one fixture containing two records that differ in CLI-versus-board handling of mission identity, completion, or window membership through both report paths; assert equal mission counts, completed-mission identities, and cycle-time figures. Confirm this assertion fails at the mission parent commit (red) because the paths use separate semantics, then retain it as the green regression after the shared service is adopted.
- CP 2: Extract and unit-test the application statistics service for mission keying, `closed === 'yes'` completion, reporting-window filtering, UTC instant bucketing, rollup/stage handling, and ordered metric evaluation.
- CP 3: Convert the CLI stats command and board metric projection to thin adapters over the service; change `buildBoardMetrics` to one named input; remove duplicated semantic definitions, positional overloads, and unchecked series casts.
- CP 4: Add focused parity, semantic-ownership, UTC-offset, synthetic-history work-bound, and named-input coverage; run the verification gate and document final criterion evidence.

Reproduction-Test: test/task-2347.08-own-statistics-semantics-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary naming the production files and test files changed in that checkpoint.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`.
- At least one evidence row for every applicable success criterion. Accepted evidence is a file:line reference, an exact test name, an ADR reference, a test file path, or a recognized repository command/path such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For CP 1, record the reproduction test path, the fixture scenario, and red-at-parent / green-after-fix result using the test path plus the exact test name or command.
- For CP 2 and CP 3, cite the shared-service and adapter file:line references that demonstrate ownership and named input.
- For CP 4, cite exact focused test names and `./scripts/verify-local.sh all` output alongside the associated test file paths or code references.
- Raw `stat`/`ls` output or generic prose alone is not evidence: pair any shell output with an accepted file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path above.
- A concrete `Next action:` line at the bottom that identifies the next checkpoint action or states that the gate evidence has been captured.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not alter CLI report formatting, flags, output schema, database schema, or legacy CSV-import behavior.
- Do not move statistics business rules into CLI or board presentation adapters; the application service is the only permitted semantic owner.
- Keep tests local, fast, and dependency-mocked; they must not access Forgejo, launch agents, or run performance-heavy CLI commands.
- Do not modify mission workflow state, begin review, execute, or integrate during implementation without the corresponding workflow authorization.

## Stop Rules
- Stop and seek direction if preserving CLI output or flags requires changing their documented behavior.
- Stop and seek direction if the board cannot consume shared results without a database-schema change or legacy CSV-import rewrite.
- Stop and seek direction if task-2347.03 lane intervals are absent or cannot express the required ordered evaluation.
- Stop and seek direction if the required regression cannot be represented with mocked local data and would need Forgejo, a live agent, or another external service.

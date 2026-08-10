# Mission: Make mission statistics trustworthy end-to-end for experiment decisions (task-2347)

## Goal
Make the production statistics path—lifecycle and measurement persistence through the shared statistics projection, `BoardMetrics`, board FLOW/experiment surface, and overlapping `px stats` output—use one explicit, test-proven semantic contract. Operators must be able to compare experiment cohorts without repository-identity leaks, completion/dwell/time-window errors, or misleading zero values for missing data.

## Why Now
Parallix uses these figures to decide whether workflow experiments improve mission delivery. The present statistics path has accumulated competing identity, completion, lifecycle, telemetry, and presentation semantics; a plausible but incorrect metric would lead to worse experiment decisions than an unavailable one. This mission consolidates the still-relevant work from TASK-2347.01 through TASK-2347.10 before more experiment data makes the inconsistencies harder to correct.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as one consolidation mission; retain prior child-task fixes when their production-path tests prove the invariant.
- Main drivers: repository identity consolidation; atomic lifecycle history; shared BoardMetrics/CLI semantics; missing-data provenance; deterministic production-composition fixture; compact cohort comparison.

## Scope
- Define and implement one authoritative metric contract for all statistics exposed through the board or `px stats`, including source data, identity, aggregation, timestamps, windows, missing-data behaviour, sample size, legacy support, and metric class.
- Consolidate repository identity so a primary checkout and its worktrees use one identity across mission, lifecycle, measurement, operational/session, statistics, board, and CLI paths; repository filtering must precede aggregation.
- Make lifecycle history authoritative for completion, throughput, cycle time, dwell, current lane, WIP, review bounces, and historical reconstruction; use an atomic state-and-event write path.
- Define delivery completion as first entry into `done`, distinct from later administrative closure when both are retained; keep lifecycle cycle time independent from agent runtime.
- Correct time handling: state-interval dwell attribution, injected-clock current-lane aging, offset-normalized buckets, real completion-week throughput with current-week zero, and no future outcomes in historical views.
- Preserve measured, zero, unavailable, partial, and legacy/estimated provenance at the projection and board boundary, with each derived metric's own observation count or coverage.
- Consolidate shared CLI and board calculations; make review bounce and review-fix-round metrics distinct, and use canonical Mission/task metadata for cohort dimensions.
- Deliver a compact board experiment comparison and deterministic full-lifecycle fixture that exercises production composition through the BoardMetrics consumed by the board; verify shared CLI metrics agree.
- Supersede or close TASK-2347.01 through TASK-2347.10 only after their applicable requirements have demonstrable coverage in this mission.

## Out of Scope
- New analytics infrastructure, external telemetry exports, a data warehouse, or multi-operator/shared-server aggregation.
- Statistical-significance analysis, automated experiment winner selection, and new workflow/product experiments.
- A general dashboard redesign; UI work is limited to the compact FLOW/experiment decision surface needed to expose the canonical metrics and provenance.
- Reimplementing an earlier TASK-2347 child-task fix that is already correct; retain it and prove it through the required production-path coverage instead.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1 — All production statistics inputs use one repository identity; tests prove that two repositories with overlapping mission IDs do not contaminate each other and that a primary checkout and worktree aggregate as one repository.
- SC2 — Lifecycle history, not telemetry, determines mission completion, throughput, lifecycle cycle time, dwell, current lane, WIP history, and review bounces; a completed mission without telemetry is included in lifecycle metrics, while an incomplete mission with telemetry is excluded from completed throughput.
- SC3 — First transition into `done` is the documented `completedAt` delivery timestamp; a later administrative close neither changes its completion week nor extends lifecycle cycle time, and state mutation plus its lifecycle event are persisted atomically.
- SC4 — Lifecycle calculations attribute each interval to the state occupied during it, calculate current-lane age from an injected current clock even with no later events, omit `done` from current bottleneck selection, reconstruct historical flow from events, and exclude outcomes later than the requested observation time.
- SC5 — Weekly throughput uses normalized real completion instants and consistent calendar/ISO-week boundaries, includes an explicit zero-completion current week, and never reuses a prior week's non-zero value; offset-bearing timestamps have dedicated coverage.
- SC6 — Lifecycle cycle time and agent runtime remain separate metrics; absent runtime, token, or cost measurements are unavailable or partial rather than zero, and every derived displayed metric exposes its own `n` or coverage denominator.
- SC7 — Review bounce rate is calculated from `review → active` lifecycle transitions with its counting unit documented; review-fix rounds are either written by an authoritative source with tests or are removed/deprecated as a decision metric.
- SC8 — Cohort filters derive label/experiment, implementer, model/provider, and date range from canonical Mission/task metadata; the board displays a compact comparison with cohort size, lifecycle timing, review measures, runtime, tokens, cost, and per-metric availability/coverage where data exists.
- SC9 — Each statistic shared by `px stats` and BoardMetrics calls the same semantic calculation/projection contract, and production-path tests assert agreement for those shared values.
- SC10 — One authoritative metric-contract document or executable contract names every user-visible board/CLI statistic and specifies its question, source, identity key, aggregation, timestamps, window predicate, missing-data handling, sample-size meaning, legacy support, and metric class; implementation and tests conform to it.
- SC11 — A deterministic test fixture reaches production composition and the BoardMetrics consumed by the board, contains both repositories, a worktree, full/missing/incomplete telemetry, week boundary and zero week, completion plus closure, repeated review bounces, two cohorts, an offset timestamp, and historical states; it asserts hand-computed expected values and shared CLI agreement.
- SC12 — Duplicate or incorrect statistics/write paths are deleted or made explicitly read-only, relevant TASK-2347 child tasks are marked superseded/closed with evidence, and `./scripts/verify-local.sh all` succeeds without focused or unannotated skipped tests.

## Risks and Assumptions
- Risk: legacy persisted rows may lack repository scope, complete lifecycle history, or trustworthy telemetry fields. Assumption: unsupported legacy records can be explicitly marked unavailable/partial/legacy rather than silently inferred as measured data.
- Risk: earlier TASK-2347 child changes may overlap or encode a different semantic choice. Assumption: the implementer can retain correct work after comparing it with the authoritative contract and production-path regression coverage.
- Risk: changing completion and temporal semantics can alter historical board figures. Assumption: correctness and provenance take precedence; any compatibility treatment will be documented in the metric contract.
- Risk: `pr_fix_rounds` may have no authoritative writer. Assumption: deprecation/removal is acceptable if a real source cannot be established and tested.
- Risk: broad consolidation can create parallel statistics abstractions. Assumption: the existing MissionOutcome/lifecycle-event/measurement/BoardMetrics design can be repaired and simplified instead of replaced.

## Checkpoints
- CP 1: Baseline and contract. Inventory the existing production statistics path and TASK-2347.01–.10 work; create the authoritative metric contract, identify duplicate identity/completion/aggregation writers, and add focused regression coverage for the semantic failures targeted by SC1–SC7 and SC10.
- CP 2: Persistence and lifecycle semantics. Consolidate canonical repository identity and the authoritative atomic lifecycle state/event path; implement and test delivery completion, dwell, injected-clock lane age, historical reconstruction, week bucketing, and separation of lifecycle versus execution metrics.
- CP 3: Projection, cohorts, and presentation. Make the shared application projection the sole definition for overlapping board/CLI metrics; add provenance/sample coverage, canonical cohort dimensions, review semantics, and the compact board experiment comparison.
- CP 4: Production-fixture proof and closure. Build the deterministic end-to-end fixture through production composition and BoardMetrics, assert hand-computed values and CLI agreement, remove/deprecate obsolete paths, document compatibility, update applicable child-task status, and run the mission gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited markdown table `| Criterion | Evidence | Status |`
- At least one evidence row for every applicable Success Criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not enough: it may appear as supplemental context only when paired with one of the accepted file:line references, exact test names, ADR references, test file paths, or recognized repository commands/paths above.
- A concrete `Next action:` line at the bottom that names the next contract, implementation, test, or verification action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not add a new statistics architecture layer; repair and consolidate the existing MissionOutcome, lifecycle-event, measurement, statistics/application projection, BoardMetrics, board, and CLI path.
- Do not change mission semantics independently in CLI or board adapters/presentation code; adapters may translate/fetch and presentations may format only.
- Do not treat unscoped legacy rows, absent telemetry, projection failures, or incomplete lifecycle history as measured zero values.
- Do not expand into external analytics, shared-server aggregation, BI/dashboard redesign, statistical winner selection, or unrelated workflow experiments.
- Do not mark TASK-2347.01 through TASK-2347.10 superseded/closed until the final checkpoint cites the covered requirements and production-path evidence.

## Stop Rules
- Stop and request direction if the authoritative source for repository identity, delivery completion, or Mission/task cohort metadata cannot be established without changing an external data contract or migrating data outside this repository.
- Stop and request direction if preserving a legacy statistic conflicts with the documented semantics and it cannot be exposed as unavailable, partial, or legacy/estimated without a product decision.
- Stop and request direction if `pr_fix_rounds` requires a new external writer/source rather than an existing Parallix-owned data path; do not invent or infer the measurement.
- Stop and request direction if a required board or CLI semantic change would require a general UI redesign or a new analytics platform beyond this contract's scope.

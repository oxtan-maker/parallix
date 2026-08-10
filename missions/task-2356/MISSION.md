# Mission: Close remaining mission-statistics correctness gaps (task-2356)

## Goal
Make board and CLI mission statistics trustworthy for experiment decisions by repairing the remaining authority, temporal, identity, coverage, and presentation gaps without redesigning the statistics subsystem.

## Why Now
TASK-2347 established the intended lifecycle-to-statistics direction, but review identified defects that can report historical work as today's state, carry throughput into an empty reporting week, misstate metric coverage, split a repository across worktrees, and expose incompatible board and CLI semantics. Those defects undermine current experiment decisions and must be closed before further statistics features are added.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: statistics correctness closure after TASK-2347; execute the ordered checkpoints without a subsystem redesign.
- Main drivers: historical lifecycle replay, explicit current-week throughput, metric-specific observation coverage, canonical repository identity, shared lifecycle completion semantics, review-bounce correctness, and FLOW cohort rendering.

## Mandatory Execution Discipline

1. Before production edits, add or identify a regression for every residual defect at the highest practical production boundary. Board-wiring defects must exercise `BoardProjectionBuilder → production MetricsReadAdapter semantics → BoardMetrics`, or an equivalent real path; a private-helper test is insufficient.
2. For every finding, locate the current implementation and production call sites, determine whether it still exists, add a failing regression when it does, make the smallest coherent correction, and make that regression pass. If already fixed, record specific existing test/file evidence rather than reimplementing it.
3. Do not create another MissionOutcome, statistics service, repository-identity abstraction, board-only completion definition, CLI-only lifecycle statistic, alternate cohort pipeline, or compatibility façade. A new abstraction is permitted only when it becomes the sole owner and the obsolete owners are removed in this mission.
4. Do not retain semantic aliases: review-fix rounds are not bounce rate; telemetry closure is not lifecycle completion; population is not observation count; unavailable is not zero; and current Mission state is not historical state. Rename/version a changed contract and update every consumer.
5. Missing, partial, legacy, and unavailable data must remain distinguishable. Do not substitute zero, an empty string/cohort, current state, previous-period value, or a guessed repository ID to pass a test or improve a display.
6. Do not clean adjacent code, rename/reorganize files, introduce generic frameworks, or make unrelated architectural changes. Every changed source area needs a concrete success criterion.
7. Production-path evidence outweighs test doubles. Deterministic repositories and clocks are allowed, but the final fixture must use the same composition and contracts used by the operator board.

## Binding Audit Corrections (2026-08-10)

The prior CP-1 through CP-6 records are **not completion evidence** for the
items below. They may be used only as leads while re-establishing the baseline.
Do not mark a criterion PASS merely because a pre-existing focused test is
green, a checkpoint says "certified", or `./scripts/verify-local.sh all`
passes. A test that supplies a manually constructed `BoardMetrics`, gives both
surfaces the same telemetry-only rows, or resolves the same worktree path twice
does not meet this mission's production-path requirements.

The following residual defects are known to exist on the mission baseline and
must be repaired before any integration attempt:

1. FLOW labels `metrics.reviewLoopRate` as a review-to-active rate, but
   `reviewLoopRateSeries` derives it from `MissionOutcome.reviewFixRounds`.
   Replace that board metric with the documented lifecycle `review → active`
   bounce definition, or present it as separately named review-fix telemetry
   with its own truthful coverage. Cohort-only correctness is insufficient.
2. `BoardMetrics` carries only projection-wide provenance population for the
   non-cohort FLOW metrics. Add metric-owned observation counts for every
   displayed derived board statistic, and render them; merely removing a false
   `n` does not satisfy the metric-coverage contract.
3. `UsageRepository.save` and `saveAll`, and the SQLite implementation, remain
   writable without the authoritative actor/run measurement identity. Audit
   real production callers. Remove the obsolete API if it has no legitimate
   writer; otherwise replace it with the authoritative identity and a collision
   regression. Evidence from a read adapter cannot prove this criterion.
4. There is no one deterministic fixture satisfying the required combined
   repository/worktree, lifecycle-only, temporal, coverage, bounce, bottleneck,
   BoardMetrics, FLOW, and shared-CLI proof. Create that fixture with
   hand-computed expectations. It must use distinct literal primary-checkout
   and worktree paths; resolving `rev-parse --show-toplevel` from one worktree
   twice is not that proof.
5. Remove/update the stale "latest recorded week" bottleneck wording and every
   other surviving claim that describes telemetry review-fix rounds as a
   lifecycle review bounce.

Until these five items have direct production and regression evidence, this
mission is incomplete and must not be represented as ready for integration.

## Scope
- Add production-boundary regressions and a deterministic certification fixture for historical lifecycle replay, zero-current-week throughput, per-metric coverage, canonical worktree identity, review bounce, integration bottlenecks, lifecycle completion without telemetry, and board cohort presentation.
- Repair historical WIP/cumulative-flow replay so complete lifecycle history starts at intake and never seeds earlier instants from the current Mission status; retain only explicit, marked legacy fallback behavior for incomplete history.
- Materialize the current ISO reporting week in throughput, including zero completions and normalized offset-bearing timestamps.
- Carry metric values with their own observation counts through shared statistics, cohort, and board metrics; distinguish population size, unavailable data, rates, and low coverage.
- Use the existing cohort projection to render compact experiment comparisons in FLOW, including metric-specific coverage, without calculating statistics in the presentation layer.
- Converge board, lifecycle, measurement, `px stats`, and `px stats cohorts` on the canonical repository resolver for primary checkouts and worktrees while retaining repository scoping.
- Align shared CLI and board mission-flow statistics on lifecycle completion; explicitly name telemetry-only reports as telemetry/usage where applicable.
- Derive review bounce from lifecycle review-to-active history, keep review-fix rounds separate and truthful, include integration in unfinished bottleneck selection, and remove or repair incompatible usage write APIs.
- Update authority documentation only after implemented semantics are final.

## Out of Scope
- Redesigning the statistics architecture or introducing parallel MissionOutcome, statistics, cohort, or repository-identity abstractions.
- External analytics infrastructure, statistical-significance analysis, automated experiment winner selection, dashboards/charts, storage redesign, or new experiment dimensions.
- Changes to lifecycle states, general SQLite or CLI cleanup, unrelated ports-and-adapters refactors, and performance work not needed to preserve existing usable behavior.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- Historical WIP and cumulative flow reconstruct complete lifecycle histories from intake and chronological transitions: the supplied done-today fixture reports backlog, active, review, integration, and done at its hand-computed observation instants; incomplete histories remain explicitly marked fallback data.
- Weekly completions reports the selected current ISO week as zero when it contains no completions, including after a non-zero prior week, and buckets boundary and non-UTC-offset timestamps according to the documented completion authority.
- Each displayed lifecycle, dwell, bounce, runtime, token, cost, and NEL statistic carries its own contributing observation count; population size is separately named, unavailable data remains unavailable rather than zero, and low-coverage decisions use the relevant metric count.
- FLOW renders the existing selected/default label-cohort comparison with population, cycle median/p75, active/review dwell, lifecycle review-bounce rate, runtime, tokens, cost, NEL when available, and per-metric coverage; it does not recompute membership, medians, rates, or coverage.
- The primary checkout `/repos/parallix` and worktree `/tmp/parallix-task-2353` resolve to one RepositoryId for lifecycle events, measurements, board statistics, `px stats`, and `px stats cohorts`, while repository B with overlapping mission IDs remains isolated.
- Board and CLI shared mission-flow statistics count lifecycle-completed missions without usage telemetry as completed; telemetry-only reports retain explicitly telemetry/usage terminology.
- Board/cohort review-bounce values are computed from the documented lifecycle review-to-active definition rather than `reviewFixRounds`; review-fix telemetry is either proven authoritative with its own coverage or presented as unavailable.
- Current bottleneck selection can report an oldest integration mission and excludes done missions; usage write APIs either enforce the authoritative actor/run measurement identity or are removed with obsolete semantics and comments.
- A deterministic, injected-clock certification fixture independently hand-computes expected results for cross-repository/worktree identity, no-telemetry completion, zero current week, offset timestamp, review-bounce divergence, partial coverage, integration bottleneck, and historical states, and reaches the production BoardMetrics boundary consumed by FLOW plus shared CLI statistics.
- No new duplicate statistics/cohort/identity calculation path or compatibility façade remains, documentation describes final semantics, and `./scripts/verify-local.sh all` succeeds.

## Risks and Assumptions
- Historical lifecycle data may be incomplete or legacy; preserve a marked fallback without allowing it to alter fully reconstructable histories.
- Existing production composition may pass repository paths differently across CLI, board, and measurements; trace every production entry point before changing the resolver.
- Board UI tests can pass against manually constructed metrics; certification must exercise persisted authoritative facts through the production projection to BoardMetrics.
- Statistics fields with similar names can encode different authorities; do not equate telemetry closure or `reviewFixRounds` with lifecycle completion or review bounce.
- Assume documented ISO-week/timezone and lifecycle completion authority remain the source of truth; if source conflicts, stop for an explicit semantic decision rather than adding aliases.

## Checkpoints
- CP 1: Establish the red baseline. Before production edits, add or identify production-boundary regressions for done-today historical replay, zero current ISO week, metric-specific coverage, FLOW cohort visibility, primary/worktree identity, lifecycle bounce differing from review-fix rounds, integration bottleneck eligibility, and lifecycle completion with no telemetry. Record existing evidence when a finding is already fixed.
- CP 2: Repair temporal reconstruction only: lifecycle-history replay, explicit zero-current-week materialization, and week-boundary/offset cases. Prove every observation instant against hand-computed fixture state.
- CP 3: Repair semantic identity: canonical repository resolution, board/CLI mission-completion agreement, and the incompatible usage writer. Prove primary checkout and worktree share one repository-scoped population without broadening queries.
- CP 4: Repair metric contracts: metric-specific observation counts, lifecycle review bounce, review-fix telemetry separation, and integration bottleneck eligibility. Keep statistics semantics outside presentation code.
- CP 5: Expose the existing cohort projection in FLOW. Assert supplied BoardMetrics values and coverage reach wide and narrow layouts without presentation-layer statistics calculations.
- CP 6: Certify and remove contradictions. Use one deterministic cross-repository fixture with hand-computed expected results; delete/update obsolete semantic claims, update documentation after semantics settle, and run the required gate.

### Re-baseline order

Run the binding-audit regressions before treating any earlier checkpoint as
complete. The implementation order is: (1) replace the false FLOW
review-to-active metric, (2) extend the shared `BoardMetrics` contract with
metric-owned coverage and render it, (3) resolve the writable usage API, and
(4) build the single certification fixture and use it to re-prove every
previously claimed temporal, identity, lifecycle-completion, cohort, and
bottleneck result. Do not update CP-6 or request integration before step (4).

## Deterministic Certification Fixture

One deterministic, injected-clock fixture must certify the whole residual surface from authoritative persisted facts through the production `BoardMetrics` boundary consumed by FLOW and through shared CLI statistics. Its expected results must be hand-computed beside the fixture (or in a clearly named expected-results structure), not generated with production metric functions.

It must contain:

- repository A and repository B with overlapping mission IDs; repository A must be represented by both `/repos/parallix` and `/tmp/parallix-task-2353`;
- a fully measured completed mission; a lifecycle-completed mission with no usage telemetry; and an incomplete mission with usage telemetry;
- a mission spanning an ISO-week boundary and a mission completed last week when the current week has zero completions;
- a mission with two `review → active` bounces, a reviewed mission with no bounces, and a mission without review;
- a mission with runtime but no cost, and a mission with cost but no NEL;
- a current integration mission old enough to be the bottleneck; and a currently done mission whose historical state is queried before completion;
- at least two canonical Mission-label cohorts with deliberately different lifecycle cycle time, review dwell, bounce rate, runtime, and telemetry coverage; and
- at least one source timestamp bearing a non-UTC offset.

## Regression Quality Requirements

The following do not independently prove completion: testing only `weeklyThroughputSeries`, `compareCohorts`, or a repository-ID helper; snapshots of manually constructed `BoardMetrics` or UI output that bypasses production projection; field-existence checks; non-null assertions; or helper-only tests for board wiring.

At least one certification test must prove the full persisted-facts → production projection → `BoardMetrics` path. The same fixture must prove that shared CLI statistics and the board see the same repository-scoped mission population and semantic result.

Every regression must fail under the previous defective behavior for a meaningful reason. In particular, prove that reintroducing current-state seeding, removing zero-week materialization, substituting cohort size for per-metric coverage, deriving bounces from fix rounds, or deriving identity from worktree path would each fail the relevant test. Do not add focused or unannotated skipped tests.

## Acceptance Criteria

- [ ] #1 Historical WIP/cumulative flow for complete lifecycle histories starts from lifecycle events, not current Mission status.
- [ ] #2 A currently done mission is correctly reconstructed as backlog/active/review/integration at earlier fixture instants.
- [ ] #3 Legacy/incomplete histories use an explicit marked fallback and do not alter fully reconstructable histories.
- [ ] #4 Weekly completions explicitly represents the current reporting week and reports zero when the current week has zero completions.
- [ ] #5 Week-boundary and offset-bearing timestamps are covered by regression tests.
- [ ] #6 Each derived metric exposes the observation count actually used to calculate it; one projection-wide `sampleSize` is not rendered as every metric's n.
- [ ] #7 Cohort population size and per-metric observation coverage are distinct.
- [ ] #8 Low-sample/coverage warnings are based on the statistic's relevant observation count.
- [ ] #9 Existing cohort calculations reach the operator FLOW board without duplicate presentation-layer statistics logic.
- [ ] #10 FLOW exposes a compact comparison of experiment cohorts including lifecycle outcome, review behaviour, execution cost/usage and per-metric coverage.
- [ ] #11 Primary checkout and worktrees resolve to one canonical repository identity on board, measurement and CLI statistics paths.
- [ ] #12 Repository-scoped statistics remain scoped; identity convergence is not implemented by broadening queries.
- [ ] #13 Lifecycle completion remains authoritative for mission-flow statistics when usage telemetry is missing.
- [ ] #14 CLI and board use the same application-owned semantics wherever they expose the same named mission statistic.
- [ ] #15 Telemetry-only reports are explicitly named/documented as telemetry rather than silently using a different definition of mission completion.
- [ ] #16 Board review bounce rate is derived from lifecycle `review → active` history and is not calculated from `reviewFixRounds`.
- [ ] #17 Review-fix rounds, if retained, remain a separately named telemetry metric with truthful coverage.
- [ ] #18 Integration is eligible for current bottleneck detection unless a documented domain invariant proves it terminal.
- [ ] #19 `done` remains excluded from current operational bottleneck selection.
- [ ] #20 Every writable usage/measurement adapter uses the authoritative measurement identity, or obsolete write APIs are deleted.
- [ ] #21 No new parallel MissionOutcome/statistics/cohort/repository-identity architecture was introduced.
- [ ] #22 No missing/partial metric is converted to zero merely for compatibility or display.
- [ ] #23 Deterministic certification fixture contains cross-repository identity, worktree identity, no-telemetry completion, zero current week, review-bounce divergence, partial measurement coverage and historical done→earlier-state cases.
- [ ] #24 Hand-computed fixture expectations are independent of production metric implementations.
- [ ] #25 At least one certification test reaches the real BoardMetrics boundary used by FLOW.
- [ ] #26 Shared CLI/board mission statistics are proven against the same fixture population.
- [ ] #27 Regression tests demonstrably fail when each former defect is reintroduced.
- [ ] #28 Documentation describes the implemented semantics rather than intended/future semantics.
- [ ] #29 `./scripts/verify-local.sh all` passes on the final tree.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include a work summary, then the exact heading `## Goal Check`, followed by the exact 3-column table header `| Criterion | Evidence | Status |` and at least one row for every applicable Success Criterion.

Evidence must use verifiable forms Parallix accepts today: production `file:line` references; exact repository test names; existing test file paths; ADR references such as `ADR 0039`; and recognized repository commands or paths, including backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...` commands. Tie certification expectations to the fixture/test path and name, and tie semantic claims to the owning production file:line reference.

Raw `stat`/`ls` output or generic prose alone is not enough—a weak agent must pair any shell output or narrative claim with at least one accepted reference above. End every checkpoint document with a concrete `Next action:` line that names the next test, source area, or verification command.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Historical replay is sourced from lifecycle events | certification test file path, exact regression test name, and owner `file:line` | PASS/FAIL |
| Board receives cohort metrics and coverage | production owner `file:line` and FLOW rendering test file path | PASS/FAIL |
| Required verification gate ran | `./scripts/verify-local.sh all` | PASS/FAIL |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify lifecycle definitions to make a statistic pass.
- Do not create a board-only completion definition, CLI-only lifecycle statistic, alternate cohort pipeline, repository-identity abstraction, or compatibility façade for obsolete semantics.
- Do not convert missing, partial, legacy, or unavailable facts into zero, current state, previous period values, guessed repository IDs, empty cohorts, or empty strings.
- Do not perform opportunistic refactors, directory reorganizations, generic framework work, or source changes outside the statistics authority/projection/presentation path without a Success Criterion.
- Do not calculate cohort membership, medians, rates, or observation coverage in React/Ink; presentation formats supplied BoardMetrics only.

## Stop Rules
- Stop and request a semantic decision if lifecycle history cannot distinguish an explicit legacy fallback from reconstructable history, or if documented lifecycle completion/timezone authority conflicts with current production behavior.
- Stop if a proposed correction requires a new parallel statistics, cohort, MissionOutcome, repository-identity, or measurement-writer architecture rather than replacing the existing owner.
- Stop if production-path certification cannot reach persisted authoritative facts through the real BoardMetrics boundary, or if board and CLI cannot be shown to use the same repository-scoped mission population.
- Stop before broadening repository queries, changing lifecycle states, or presenting missing telemetry as zero merely to make a test or display look complete.

## Completion Evidence

Before marking this mission complete, provide the exact table below in the final checkpoint or report. Every acceptance criterion without concrete evidence is FAIL and the mission remains incomplete.

| AC | Result | Production evidence | Regression test | Why the test would catch the old bug |
| --- | --- | --- | --- | --- |
| #1 | PASS/FAIL | `file:line` | exact test name | concrete explanation |
| ... | ... | ... | ... | ... |

Do not use “implemented”, “covered”, “looks correct”, or “tests pass” as evidence without naming the source and test. The final evidence must also show that all mandatory baseline defects were reproduced or explicitly proven already fixed before unrelated production edits; that no obsolete semantic comments remain; and that final verification output is captured rather than asserted.

The pre-existing CP-6 table does not satisfy this section: it contains claims
whose cited fixture does not contain the required facts. Replace it only after
the single certification fixture exists and each cited test actually exercises
the fact named in its row.

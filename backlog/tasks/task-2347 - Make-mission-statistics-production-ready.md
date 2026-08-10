---

id: TASK-2347
title: Make mission statistics trustworthy end-to-end for experiment decisions
status: backlog
assignee: [codex]
created_date: 2026-08-08 00:00
labels:

* ai_sdlc
  priority: high
  dependencies: []

---

## Description

Make Parallix mission statistics production-ready in one cleanup mission.

Statistics are a decision system, not dashboard decoration. Parallix uses lifecycle, throughput, review, agent-runtime and usage statistics to determine whether workflow experiments improve mission delivery. A statistically plausible but semantically wrong number is therefore worse than an unavailable number.

This mission owns the full production path:

`mission lifecycle + agent measurements
  → SQLite
  → statistics/application projection
  → BoardMetrics
  → board FLOW/experiment UI
  → px stats where the same metric is exposed`

The mission is complete when that path has one coherent definition of repository identity, mission completion, lifecycle time, runtime, historical windows, missing data and experiment cohorts, and when an end-to-end fixture proves the resulting figures against hand-computed expectations.

Existing fixes from the earlier TASK-2347 children must be retained and verified rather than reimplemented unnecessarily. TASK-2347.01 through TASK-2347.10 are superseded by this mission once their still-relevant acceptance criteria have been absorbed here.

## Goal

An operator looking at Parallix statistics must be able to answer, with trustworthy data:

1. How many missions actually completed in the selected period?
2. How long did missions spend end-to-end and in each lifecycle state?
3. How much agent execution, tokens and cost did those missions require?
4. Where are missions currently waiting?
5. How often do missions bounce from review back to active?
6. Did experiment/cohort A perform better than cohort B?
7. How much data supports each displayed statistic?
8. Is a value genuinely zero, unavailable, partial, legacy-derived or estimated?

CLI and board must not disagree about the same metric.

## Required invariants

### 1. One canonical repository identity

Resolve repository identity exactly once for a primary checkout and reuse that identity for:

* Mission persistence
* lifecycle events
* usage/agent measurements
* statistics queries
* board projection
* CLI statistics
* session/operational records that participate in statistics

A worktree and its primary checkout must resolve to the same repository identity.

No statistics adapter or presentation composition may independently derive a competing repository ID from `rootDir`, package name, basename or another heuristic.

All statistics queries must be repository-scoped before aggregation.

Legacy unscoped data must never silently contaminate repository-scoped statistics.

### 2. Lifecycle is authoritative for mission flow

Mission lifecycle state/history is the authority for:

* mission existence
* state transitions
* lifecycle dwell
* current lane
* delivery completion
* lifecycle cycle time
* throughput

Agent/usage telemetry is supplementary and must not be required for a completed mission to appear in lifecycle or throughput statistics.

If a mission completed but usage telemetry is absent:

* throughput remains correct
* lifecycle cycle time remains available
* lifecycle dwell remains available
* agent runtime/tokens/cost are unavailable for that mission rather than zero

### 3. Define delivery completion explicitly

Use one documented event as the delivery-completion timestamp.

Unless a stronger domain reason is discovered during implementation, delivery completion is the **first transition into ****`done`**, normally `integration → done`.

A later administrative `done → done` close event may terminate final-state dwell or record closure bookkeeping, but must not move the mission into another throughput week or extend delivery cycle time.

If both concepts are retained, name them separately:

* `completedAt` / delivery completion
* `closedAt` / administrative closure

Never overload one timestamp with both meanings.

### 4. Complete and atomic lifecycle history

Every mission must have sufficient lifecycle history to reconstruct its flow:

* initial backlog/intake entry
* every actual lane transition
* review bounces
* integration → done
* any administrative close event needed for bookkeeping

Mission state mutation and its corresponding lifecycle event must use one authoritative transactional write path where both must succeed or neither is committed.

Remove or prevent competing transition write paths.

### 5. Correct lifecycle dwell semantics

Elapsed time between two transitions belongs to the state the mission occupied during that interval.

Example:

`08:00 backlog → active`
`09:00 active → review`

must produce:

`active dwell = 60 min`

and never `review dwell = 60 min`.

Current-lane age is:

`now - enteredCurrentLaneAt`

using an injected clock for deterministic tests.

The age must continue increasing even when no new telemetry arrives.

`done` may be reported historically, but completed work must not be selected as the current operational bottleneck.

### 6. Keep lifecycle cycle time and agent runtime separate

Lifecycle cycle time is wall-clock mission flow time:

`completedAt - lifecycleStartAt`

Agent runtime is measured execution time from agent runs.

Do not derive lifecycle cycle time from accumulated `duration_minutes`.

Do not treat missing agent runtime as zero.

Both metrics may be displayed together because their difference is decision-useful.

### 7. Correct temporal statistics

Every time-based metric must have an explicit time predicate.

Weekly throughput must:

* count only lifecycle-completed missions
* bucket by the documented completion timestamp
* use real calendar/ISO-week boundaries consistently
* emit the current week even when its value is zero
* never carry the previous non-zero week forward as "this week"

Historical statistics must only use information available at the requested instant.

An outcome completed after `t` must not influence a metric evaluated at `t`.

Timestamps must be parsed as real instants and normalized before bucketing; string slicing must not reinterpret offset timestamps as UTC.

### 8. Reconstruct historical flow from history, not today's state

Cumulative flow / WIP history must not start from the mission's current state and replay older transitions on top of it.

For missions with complete event history:

* start absent
* intake/initial-entry event introduces the mission
* replay transitions forward through time

Current Mission state may only be used as an explicitly marked fallback for incomplete/legacy history.

Tests must cover a mission that is `done` today but was backlog/active/review at earlier observation points.

### 9. Honest missing-data and provenance semantics

The metrics contract must distinguish at least:

* measured value
* genuine zero
* unavailable
* partial coverage
* legacy/estimated value where applicable

Projection/storage failure must never silently become a believable zero.

Every displayed derived metric must expose the number of observations actually used for that metric.

Do not attach one global mission count to statistics calculated from different subsets.

Examples:

* lifecycle cycle time: `n=20`
* review dwell: `n=17`
* runtime: `n=14`
* cost: `n=6`

Low-sample warnings must use that metric's own sample size.

Where useful, also expose total cohort size and coverage, e.g. `6/20 missions have cost telemetry`.

### 10. One statistics semantic model for CLI and board

Metric definitions belong in application/domain statistics code, not independently in CLI and board adapters.

Where `px stats` and BoardMetrics expose the same concept they must call the same calculation or projection contract.

Remove duplicated completion, identity, time-window and aggregation semantics.

Adapters may fetch/translate data and presentations may format it; neither should redefine what a completed mission, cycle time, throughput week or review bounce means.

### 11. Make review metrics semantically precise

Keep separate concepts separate:

**Review bounce rate**

Derived from lifecycle transitions:

`missions with review → active bounce / missions that entered review`

Document whether repeated bounces count once per mission or as events and name the metric accordingly.

**Review fix rounds**

A measurement of review/fix iterations if Parallix has a trustworthy writer/source for it.

Ensure its writer actually records the value. If `pr_fix_rounds` has no authoritative source, either wire that source correctly or remove/deprecate the misleading statistic.

Never label average fix-round count as a "review-to-active loop rate".

### 12. Canonical experiment/cohort dimensions

Experiment comparison must use canonical mission/product data rather than inferred presentation data.

At minimum support:

* Mission label / experiment label
* implementer
* model
* provider/agent family
* date range

Mission labels must come from canonical Mission/task metadata, not a telemetry classification field masquerading as labels.

Telemetry classification such as `ai_sdlc`, `user_value` or `unknown` may remain a separate dimension if useful.

A cohort comparison should be able to show, when data exists:

* cohort size
* median lifecycle cycle time
* p75 lifecycle cycle time
* active dwell
* review dwell
* review bounce rate
* review fix rounds
* agent runtime
* tokens per completed mission
* cost per completed mission
* NEL or equivalent output measure

Every metric carries its own `n`/coverage.

### 13. Reach the operator board

The statistics cleanup is not complete if the trustworthy experiment projection stops before the presentation layer.

The board FLOW/experiment surface must expose enough of the cohort comparison to make an experiment decision without inspecting SQLite or running bespoke code.

Keep this deliberately compact; this mission is not a general dashboard redesign.

A minimal decision surface is sufficient, e.g.:

| metric         | cohort A | cohort B |
| -------------- | -------: | -------: |
| lifecycle n    |       18 |       21 |
| median cycle   |      74m |      91m |
| p75 cycle      |     122m |     168m |
| active dwell   |      39m |      44m |
| review dwell   |      13m |      31m |
| bounce rate    |      17% |      38% |
| agent runtime  |      28m |      27m |
| tokens/mission |      84k |      71k |
| cost/mission   |     0.51 |     0.44 |

Unavailable/partial fields must remain visibly unavailable/partial rather than becoming zero.

### 14. Measurement identity is consistent

Any remaining usage/measurement persistence API must obey the same identity contract as the production measurement store, including actor/run identity where required.

Do not leave a writable repository API whose conflict key collapses measurements from different actors into one row.

If an adapter is now read-only in architecture, make that explicit instead of preserving an incorrect write path.

## Metric contract

Create or update one authoritative metric-contract document or executable contract that states for every board/CLI statistic:

* name
* question answered
* source-of-truth data
* identity key
* numerator/denominator or aggregation rule
* start/end timestamp semantics
* time-window predicate
* missing-data behaviour
* sample-size meaning
* whether legacy data is supported
* whether the metric is lifecycle, execution, usage or derived experiment data

The implementation and tests must use these definitions.

## Verification strategy

Use one deterministic fixture that contains enough variation to catch semantic regressions.

At minimum include:

* two repositories with overlapping mission IDs
* a worktree and primary checkout for the same repository
* mission with full telemetry
* completed mission with no usage telemetry
* incomplete mission with usage telemetry
* mission spanning a week boundary
* a current week with zero completions
* mission with `integration → done` followed later by administrative close
* mission with multiple review → active bounces
* mission with missing runtime/cost/token measurements
* two experiment labels/cohorts
* timestamps containing a non-UTC offset
* a mission currently done whose historical state is queried while it was backlog/active/review

Hand-compute expected results from the fixture and assert them through the **production composition path**, not only individual metric helper functions.

The end-to-end assertion must reach the same BoardMetrics consumed by the board.

Where CLI exposes the same statistics, assert agreement between CLI/application output and BoardMetrics for the shared metrics.

## Acceptance Criteria

* [ ] One canonical repository identity is used end-to-end; cross-repository contamination and worktree identity splits are covered by tests.
* [ ] Completed lifecycle missions contribute to throughput/cycle statistics even when usage telemetry is absent.
* [ ] Incomplete missions with telemetry do not masquerade as completed throughput.
* [ ] First entry into `done` is explicitly defined and tested as delivery completion, distinct from later administrative closure if both remain.
* [ ] Intake and all lifecycle transitions needed for reconstruction are persisted through one authoritative atomic state/event path.
* [ ] Lifecycle dwell is attributed to the state occupied during the interval.
* [ ] Current lane age uses the current injected clock and keeps aging without later events.
* [ ] Agent runtime and lifecycle cycle time are independent metrics.
* [ ] Weekly throughput uses real completion timestamps, correct week buckets and an explicit zero for a zero-completion current week.
* [ ] Historical metrics contain no future outcomes.
* [ ] Historical cumulative flow is reconstructed from lifecycle history rather than seeded from current state.
* [ ] Timestamp offsets are normalized correctly before bucketing.
* [ ] `done` is not reported as the current operational bottleneck.
* [ ] Projection/recording failures and absent telemetry cannot render as plausible zero values.
* [ ] Every displayed derived metric reports its own sample size/coverage.
* [ ] Review bounce rate is derived from lifecycle transitions and is not conflated with review-fix rounds.
* [ ] `pr_fix_rounds` is either backed by an authoritative writer and tested or removed/deprecated as a decision metric.
* [ ] Experiment labels come from canonical Mission/task metadata.
* [ ] Cohorts support label, implementer, model/provider and date-range comparison using shared statistics semantics.
* [ ] The board exposes a compact experiment comparison with per-metric provenance.
* [ ] CLI and board share the same definitions for every statistic they both expose.
* [ ] Obsolete or incorrect alternate statistics/write implementations are deleted or made explicitly read-only.
* [ ] TASK-2347.01 through TASK-2347.10 are marked superseded/closed once their still-valid requirements are demonstrably covered by this mission.
* [ ] The metric contract documents every user-visible statistic and matches implementation/tests.
* [ ] A deterministic full-lifecycle E2E fixture asserts BoardMetrics against hand-computed expected values through production composition.
* [ ] Regression tests demonstrate the previously identified incorrect behaviours would fail.
* [ ] `./scripts/verify-local.sh all` passes on the final tree.

## Out of Scope

* New analytics infrastructure or external telemetry/export systems
* General-purpose BI/dashboard work
* Statistical significance testing or automated experiment winner selection
* Multi-operator/shared-server aggregation
* Long-term data warehouse design
* New workflow/product experiments unrelated to making existing experiment measurements trustworthy
* UI redesign beyond the compact statistics/cohort decision surface required above

## Definition of Done

* [ ] Production board statistics satisfy every required invariant above.
* [ ] There is one authoritative semantic implementation for shared board/CLI metrics.
* [ ] The full lifecycle fixture proves the numbers end-to-end with hand-computed expected results.
* [ ] Missing/partial data is visibly honest at the presentation boundary.
* [ ] The operator can compare two labelled experiment cohorts from the board and see the lifecycle outcome, execution cost and sample coverage needed to make a decision.
* [ ] Verification gate ran and passed on the final tree with captured proof rather than an unverified claim.
* [ ] Lint and static analysis report clean on every changed file.
* [ ] No focused or unannotated skipped tests were introduced.
* [ ] Final checkpoint Goal Check cites concrete file evidence and named tests.
* [ ] Documentation reflects the final metric definitions and any user-facing changes.

## Implementation constraint

Do not create another statistics architecture wave.

Prefer repairing and consolidating the existing MissionOutcome / lifecycle-event / measurement / BoardMetrics design. Delete duplicate semantics rather than introducing another abstraction alongside them.

Where an earlier TASK-2347 fix already satisfies an invariant, prove it with the production-path regression test and move on.

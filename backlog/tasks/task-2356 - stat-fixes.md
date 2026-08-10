---
id: TASK-2356
title: stat fixes
status: backlog
assignee: []
created_date: '2026-08-10 12:30'
labels: []
dependencies: []
ordinal: 91911
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
---

id: TASK-2353
title: Close the remaining mission-statistics correctness gaps after TASK-2347
status: backlog
assignee: []
created_date: '2026-08-10 14:25'
labels:

* statistics
* correctness
* ai_sdlc
* cleanup
  priority: high
  dependencies:
* TASK-2347
  references:
* src/application/projections/metrics.ts
* src/application/projections/metrics-read-adapter.ts
* src/application/projections/cohorts.ts
* src/application/projections/board.ts
* src/application/projections/board-readers.ts
* src/application/services/statistics-service.ts
* src/adapters/cli/commands/stats.ts
* src/adapters/cli/commands/stats-cohorts.ts
* src/adapters/sqlite/usage-repository.ts
* src/interfaces/tui/flow-panel.tsx
* docs/authority-reference.md
* test/

---

## Description

TASK-2347 substantially repaired mission-statistics authority and lifecycle semantics, but its post-completion review found a smaller set of residual defects that still prevent the statistics surface from being trusted for experiment decisions.

This mission closes those residual defects.

**Do not redesign the statistics subsystem.**

The existing direction is sound:

`canonical Mission lifecycle + agent measurements
  → shared statistics semantics
  → BoardMetrics / cohort comparison
  → CLI + board presentation`

Repair that path in place.

The mission is successful when Parallix can use the board and CLI to compare experiments without:

* reconstructing historical state from today's state,
* carrying an old week's throughput into a zero-completion week,
* displaying false sample sizes,
* hiding cohort results before they reach the operator,
* resolving the same repository differently on different statistics paths,
* conflating review bounces with review-fix telemetry,
* or maintaining alternate statistics writers/readers with incompatible identity or completion semantics.

This is a **correctness closure mission**, not a feature wave.

---

# Execution discipline — mandatory

The previous statistics work accumulated small fixes that could look correct locally while leaving the production path inconsistent. This mission must therefore be performed differently.

## Rule 1 — reproduce before modifying

Before changing production code, add or identify a regression test that demonstrates each residual defect against the highest practical production boundary.

For defects involving board wiring, a helper-level unit test is **not sufficient**.

The test must exercise:

`BoardProjectionBuilder
  → production MetricsReadAdapter semantics
  → BoardMetrics`

or the equivalent real application path.

A defect is not considered reproduced merely because a private helper returns an undesirable value.

## Rule 2 — prove the current code before assuming the review is right

For every finding below:

1. locate the current implementation and all production call sites,
2. determine whether the finding still exists,
3. add a failing regression when it exists,
4. make the smallest coherent correction,
5. make that regression pass.

If the code has already changed and the stated defect no longer exists, do **not** reimplement it. Record the existing test/file evidence and continue.

## Rule 3 — no parallel statistics architecture

Do not introduce:

* another MissionOutcome type,
* another statistics service beside the current one,
* another repository-identity abstraction beside the canonical one,
* a board-only definition of completion,
* a CLI-only definition of lifecycle statistics,
* an alternate cohort pipeline,
* compatibility façades preserving obsolete semantics.

A new abstraction is acceptable only when it becomes the single owner of semantics previously duplicated and the obsolete implementations are removed in the same mission.

## Rule 4 — no semantic aliases

Do not preserve an incorrectly named metric by changing only its implementation or label while leaving another consumer to interpret it differently.

Examples:

* review-fix rounds are not review bounce rate,
* telemetry closure is not lifecycle delivery completion,
* global cohort size is not per-metric observation count,
* unavailable is not zero,
* current Mission state is not historical state.

If a contract changes meaning, rename/version it deliberately and update every consumer.

## Rule 5 — no fake resilience

Do not make tests pass by converting missing/failed data into:

* `0`,
* empty strings,
* empty cohorts,
* current state,
* previous period values,
* guessed repository IDs.

Missing, partial, legacy and unavailable data must remain distinguishable.

## Rule 6 — no opportunistic refactoring

Do not clean adjacent code merely because it is nearby.

Changes outside the statistics authority/projection/presentation path require a concrete acceptance criterion from this mission.

Do not rename files, reorganize directories, introduce generic frameworks, or perform architectural cleanup unrelated to a demonstrated residual defect.

## Rule 7 — production-path evidence beats test doubles

Tests may use deterministic repositories/clocks, but at least one final fixture must exercise the same composition and contracts used by the operator board.

A suite of green isolated tests is not proof if production wiring can still pass different identities, baselines or clocks.

---

# Residual correctness requirements

## 1. Reconstruct historical flow from lifecycle history

Historical WIP and cumulative-flow statistics must represent what was true **at the historical instant**.

For missions with complete lifecycle history:

* the mission does not exist before its intake/initial-entry event,
* the intake event introduces its first lifecycle state,
* later transitions are replayed chronologically,
* today's Mission status must not seed historical reconstruction.

Example fixture:

```text
Mon 09:00  intake → backlog
Tue 10:00  backlog → active
Wed 11:00  active → review
Thu 12:00  review → integration
Thu 13:00  integration → done

Mission status today = done
```

Expected historical projection:

```text
Mon 10:00 = backlog
Tue 11:00 = active
Wed 12:00 = review
Thu 12:30 = integration
Thu 14:00 = done
```

It must never begin Monday as `done` because the current Mission object is done.

### Legacy history

A mission lacking reconstructable event history may use an explicit legacy fallback, but:

* the fallback must be marked as estimated/legacy,
* it must not contaminate fully reconstructable missions,
* current state must not silently become historical fact.

If the `initialStates` argument remains in the projection API, its semantics must make this distinction explicit. Prefer removing it from history reconstruction if it is no longer needed there.

---

## 2. Make current-period throughput explicit, including zero

`Weekly completions` means completions in the **current reporting week**, not the latest week that happened to contain a completion.

Given:

```text
week 31 = 7 completions
week 32/current = 0 completions
```

the board must show:

```text
Weekly completions: 0
```

not `7`.

Weekly throughput therefore needs an explicit reporting instant/window and must materialize empty periods where the presentation claims to show the current period.

Use the existing documented completion authority and ISO-week/timezone semantics. Do not introduce a second completion timestamp.

Tests must cover:

* zero-completion current week,
* completion exactly around a week boundary,
* previous non-zero week followed by zero,
* non-UTC source timestamps normalized before bucketing.

---

## 3. Give every derived statistic truthful observation coverage

Remove the assumption that one global mission count is the sample size for every metric.

The contract must distinguish:

**Population/cohort size**

How many missions belong to the selected population.

**Observation count**

How many observations actually contributed to this particular statistic.

Examples:

```text
cohort size                   20
lifecycle cycle time      n = 20
active dwell              n = 18
review dwell              n = 13
review bounce rate        n = 12 missions entering review
agent runtime             n = 17
tokens                    n = 16
cost                      n = 4
NEL                       n = 11
```

A metric calculated from four observations must not inherit `n=20`.

### Contract

Use one coherent metric-evidence representation rather than adding ad-hoc fields such as:

* `costSampleSize`
* `runtimeSampleSize`
* `reviewSampleSize`
* etc.

A suitable shape may resemble:

```ts
interface MeasuredValue<T> {
  readonly value: T | null;
  readonly observationCount: number;
}
```

but the exact type is an implementation decision.

The important invariants are:

* value and observation count travel together,
* unavailable data has `value = null`,
* exact counts are not misleadingly presented as sampled medians,
* rates expose the denominator they were calculated from,
* low-sample decisions use the observation count for the metric being judged.

Do not attach the projection-wide `provenance.sampleSize` to individual lane/runtime/cohort metrics.

Retain an overall population size if useful, but give it a name that does not imply it is every metric's `n`.

---

## 4. Render experiment cohorts on the operator board

The cohort calculation must reach the operator.

FLOW currently being able to calculate cohort statistics is not enough.

Add a compact experiment comparison surface to the existing board using the existing cohort projection.

This is **not** a dashboard redesign.

A textual/TUI representation is sufficient.

At minimum, for the selected/default cohort dimension, make it possible to compare cohorts on:

* cohort/population size,
* median lifecycle cycle time,
* p75 lifecycle cycle time,
* active dwell,
* review dwell,
* review bounce rate,
* agent runtime,
* tokens per mission,
* cost per mission,
* NEL when available.

Show per-metric observation coverage wherever it differs.

Example:

```text
EXPERIMENT · label

                         restart        compact
missions                      20             18
cycle median             74m n20        91m n18
cycle p75               122m n20       168m n18
active dwell             39m n18        44m n17
review dwell             13m n12        31m n14
review bounce          17% n12        38% n14
agent runtime            28m n17        27m n15
tokens                    84k n16        71k n14
cost                    $0.51 n4       $0.44 n6
NEL                        312 n11         287 n9
```

Do not imply statistical significance or automatically declare a winner.

Low sample/low coverage should be visible.

---

## 5. Use one canonical repository identity on every statistics entry point

Board, Mission lifecycle, measurements and CLI statistics must refer to the same repository using the same resolver.

`px stats cohorts`, ordinary `px stats`, board composition and measurement writing must not independently infer repository identity from different combinations of:

* `process.cwd()`,
* `rootDir`,
* checkout basename,
* package/product name,
* worktree path.

A worktree and its primary checkout must resolve to the same statistics repository.

### Required proof

Create a test using:

```text
primary checkout:
/repos/parallix

worktree:
/tmp/parallix-task-2353
```

and show that:

* lifecycle events written from either path,
* measurement rows,
* board statistics,
* `px stats cohorts`,
* and any shared mission-level CLI statistics

all resolve/query the same `RepositoryId`.

Explicit `--repo` override may remain if it is a supported feature, but the default path must use canonical identity.

Do not solve this by making repository queries unscoped.

---

## 6. Make CLI and board completion semantics agree where they claim the same thing

Lifecycle completion is authoritative for mission delivery statistics.

A completed lifecycle mission without usage telemetry must still be a completed mission for:

* throughput,
* mission cycle time,
* cohort membership,
* other mission-flow statistics.

If ordinary `px stats` contains reports that intentionally describe **telemetry rows rather than mission lifecycle**, keep that capability but name and document it as telemetry/usage reporting.

It must not reuse language such as "completed missions" if it is really counting `usage_statistics.closed = yes`.

Where CLI and board expose the same named mission statistic, both must use the same application-owned semantic calculation.

Do not make board semantics worse merely to match an older CLI implementation.

---

## 7. Replace the board's fake review-loop rate with lifecycle review bounce semantics

There are two different quantities:

### Review bounce rate

Lifecycle fact.

At mission level:

```text
denominator:
missions that entered review

numerator:
missions/events satisfying the documented review → active bounce definition
```

Choose and document whether the board reports:

* proportion of reviewed missions that bounced at least once, or
* bounce events per reviewed mission.

Prefer the existing cohort definition unless there is a demonstrated reason to change it.

### Review fix rounds

Telemetry/operational measurement.

This may remain separately if it has a trustworthy writer and its coverage is shown.

Do not derive something called:

`Review-to-active loop rate`

from `reviewFixRounds`.

Board and cohort implementations must use one shared review-bounce calculation rather than duplicating the transition scan.

Update the bottleneck narrative inputs accordingly.

---

## 8. Do not exclude integration from bottleneck detection unless it is truly terminal

`done` is terminal and must not become the operational bottleneck.

`integration` is still unfinished delivery work.

Unless an explicit domain rule proves otherwise, missions waiting in integration must participate in current lane-age/bottleneck selection.

Add a regression where integration has the highest current age and verify it can be reported as the bottleneck.

Do not change lifecycle state definitions just to satisfy this statistic.

---

## 9. Remove or repair the incompatible usage write path

Audit all production references to `SqliteUsageRepository.save` / `saveAll`.

The measurement schema has an actor/run identity contract. No writable adapter may silently collapse measurements by omitting part of that identity.

After inspecting production call sites:

### If the adapter is read-only in the current architecture

Remove the write methods from the relevant port/adapter and tests.

Do not leave a misleading writable API "for compatibility".

### If it is still a legitimate writer

Make it use the exact same measurement identity contract as the authoritative production writer, including actor identity where required, and add a collision regression proving two actors/stages/runs cannot overwrite or alias each other incorrectly.

Do not create a third measurement writer.

---

## 10. Make review-fix telemetry honest

Trace where `pr_fix_rounds` is actually written.

If there is an authoritative writer:

* prove it with a test,
* retain the metric as review-fix telemetry,
* give it its own observation coverage.

If no authoritative writer exists:

* remove it from experiment-decision surfaces, or
* explicitly classify it as unavailable.

Do not synthesize fix rounds from lifecycle bounces merely to populate the field. They are different measurements.

---

# Required implementation sequence

The implementer must work in these checkpoints.

## Checkpoint A — establish the red baseline

Before production changes, add failing regressions for at least:

1. done-today mission reconstructed correctly in historical lanes,
2. current ISO week with zero completions,
3. metric-specific observation counts,
4. cohort data visible through the operator FLOW projection/presentation,
5. worktree and primary checkout resolving to one statistics repository,
6. actual review bounce rate differing from `reviewFixRounds`,
7. integration being eligible as current bottleneck,
8. lifecycle-completed/no-telemetry mission agreeing across shared mission-statistics surfaces.

Capture the failure reason for each.

If one already passes because code changed since review, record the existing evidence instead of manufacturing a change.

**Gate:** no broad production refactor before this baseline exists.

---

## Checkpoint B — fix temporal reconstruction

Fix:

* historical state reconstruction,
* zero-current-week throughput,
* temporal edge-case regressions.

Do not touch cohort presentation or repository identity in this checkpoint unless required to make the production test fixture run.

**Gate:** historical fixture produces hand-computed states/counts at every observation instant.

---

## Checkpoint C — fix semantic identity

Fix:

* canonical repository resolution,
* CLI/board mission-completion agreement,
* obsolete/incompatible measurement writer.

**Gate:** one fixture written/read through primary checkout and worktree produces the same repository-scoped mission population across board and CLI.

---

## Checkpoint D — fix metric contracts and review semantics

Fix:

* per-metric observation counts,
* review bounce rate,
* review-fix telemetry separation,
* bottleneck integration eligibility.

Keep presentation-independent semantics in application/domain statistics code.

**Gate:** helper tests and production projection tests agree on the hand-computed results.

---

## Checkpoint E — expose cohorts in FLOW

Render the existing experiment comparison without creating a new statistics projection.

Do not duplicate cohort math in React/Ink.

The presentation may:

* choose layout,
* format units,
* display availability/coverage,
* flag low samples.

It may not calculate cohort membership, medians, rates or coverage.

**Gate:** rendering tests assert the supplied BoardMetrics values and n/coverage reach both wide and narrow FLOW layouts without being recomputed.

---

## Checkpoint F — delete contradictions and certify

Search for and remove obsolete code/comments/contracts that still claim:

* current Mission state is a historical baseline,
* reviewFixRounds is review bounce rate,
* one global sample size applies to every metric,
* telemetry `closed=yes` is authoritative mission completion,
* `rootDir` itself is canonical repository identity,
* integration is terminal for bottleneck purposes,
* every cohort metric uses cohort size as its n.

Update documentation only after code semantics are final.

Run the complete verification gate on the final tree.

---

# Deterministic certification fixture

Add one fixture rich enough to certify the entire residual surface.

It must contain at least:

### Repositories

* repository A,
* repository B with overlapping mission IDs,
* a primary checkout and worktree for repository A.

### Missions

1. fully measured completed mission,
2. lifecycle-completed mission with no usage telemetry,
3. incomplete mission with usage telemetry,
4. mission spanning an ISO-week boundary,
5. mission completed last week while current week has zero completions,
6. mission with two review → active bounces,
7. reviewed mission with zero bounces,
8. mission without review,
9. mission with runtime but no cost,
10. mission with cost but no NEL,
11. mission currently in integration long enough to be bottleneck,
12. mission currently done whose historical states are queried before completion.

### Cohorts

At least two canonical Mission-label cohorts with deliberately different:

* lifecycle cycle time,
* review dwell,
* bounce rate,
* runtime,
* telemetry coverage.

### Time

Use an injected clock and include at least one source timestamp with a non-UTC offset.

### Expected results

Record hand-computed expected values directly beside the fixture or in a clearly named expected-results structure.

Do not generate the expectations using the production metric functions themselves.

That would make the test circular.

---

# Anti-slop test requirements

The following tests do **not** independently prove completion:

* testing only `weeklyThroughputSeries`,
* testing only `compareCohorts`,
* testing only a repository-ID helper,
* snapshotting a manually constructed `BoardMetrics`,
* snapshotting UI output without exercising the production projection,
* checking that a field exists,
* checking only that a value is non-null.

At least one certification test must prove the full path from authoritative persisted facts to the BoardMetrics consumed by FLOW.

For shared CLI statistics, the fixture must prove both surfaces observe the same mission population and semantic result.

### Mutation-style regression expectation

Each regression should fail for the old behaviour for a meaningful reason.

Examples:

* reintroducing current-state seeding makes historical-state test fail,
* removing zero-week materialization makes current-week test fail,
* replacing per-metric n with cohort size makes coverage test fail,
* deriving bounce rate from fix rounds makes deliberately divergent fixture fail,
* deriving repo from worktree path makes repository identity test fail.

Avoid tests that remain green under the bug they supposedly guard.

---

# Acceptance Criteria

* [ ] #1 Historical WIP/cumulative flow for complete lifecycle histories starts from lifecycle events, not current Mission status.
* [ ] #2 A currently done mission is correctly reconstructed as backlog/active/review/integration at earlier fixture instants.
* [ ] #3 Legacy/incomplete histories use an explicit marked fallback and do not alter fully reconstructable histories.
* [ ] #4 Weekly completions explicitly represents the current reporting week and reports zero when the current week has zero completions.
* [ ] #5 Week-boundary and offset-bearing timestamps are covered by regression tests.
* [ ] #6 Each derived metric exposes the observation count actually used to calculate it; one projection-wide `sampleSize` is not rendered as every metric's n.
* [ ] #7 Cohort population size and per-metric observation coverage are distinct.
* [ ] #8 Low-sample/coverage warnings are based on the statistic's relevant observation count.
* [ ] #9 Existing cohort calculations reach the operator FLOW board without duplicate presentation-layer statistics logic.
* [ ] #10 FLOW exposes a compact comparison of experiment cohorts including lifecycle outcome, review behaviour, execution cost/usage and per-metric coverage.
* [ ] #11 Primary checkout and worktrees resolve to one canonical repository identity on board, measurement and CLI statistics paths.
* [ ] #12 Repository-scoped statistics remain scoped; identity convergence is not implemented by broadening queries.
* [ ] #13 Lifecycle completion remains authoritative for mission-flow statistics when usage telemetry is missing.
* [ ] #14 CLI and board use the same application-owned semantics wherever they expose the same named mission statistic.
* [ ] #15 Telemetry-only reports are explicitly named/documented as telemetry rather than silently using a different definition of mission completion.
* [ ] #16 Board review bounce rate is derived from lifecycle `review → active` history and is not calculated from `reviewFixRounds`.
* [ ] #17 Review-fix rounds, if retained, remain a separately named telemetry metric with truthful coverage.
* [ ] #18 Integration is eligible for current bottleneck detection unless a documented domain invariant proves it terminal.
* [ ] #19 `done` remains excluded from current operational bottleneck selection.
* [ ] #20 Every writable usage/measurement adapter uses the authoritative measurement identity, or obsolete write APIs are deleted.
* [ ] #21 No new parallel MissionOutcome/statistics/cohort/repository-identity architecture was introduced.
* [ ] #22 No missing/partial metric is converted to zero merely for compatibility or display.
* [ ] #23 Deterministic certification fixture contains cross-repository identity, worktree identity, no-telemetry completion, zero current week, review-bounce divergence, partial measurement coverage and historical done→earlier-state cases.
* [ ] #24 Hand-computed fixture expectations are independent of production metric implementations.
* [ ] #25 At least one certification test reaches the real BoardMetrics boundary used by FLOW.
* [ ] #26 Shared CLI/board mission statistics are proven against the same fixture population.
* [ ] #27 Regression tests demonstrably fail when each former defect is reintroduced.
* [ ] #28 Documentation describes the implemented semantics rather than intended/future semantics.
* [ ] #29 `./scripts/verify-local.sh all` passes on the final tree.

---

# Out of Scope

* redesigning the statistics architecture,
* external analytics/BI infrastructure,
* statistical significance tests,
* automated experiment winner selection,
* new charting/dashboard frameworks,
* long-term warehouse/storage redesign,
* adding new experiment dimensions beyond those already supported,
* changing lifecycle states,
* general SQLite cleanup,
* general CLI cleanup,
* unrelated ports-and-adapters refactoring,
* performance optimisation unless required to keep existing behaviour usable.

---

# Definition of Done

* [ ] #1 Every acceptance criterion has concrete evidence from the final tree.
* [ ] #2 The eight mandatory baseline defects were reproduced or explicitly proven already fixed before unrelated production edits.
* [ ] #3 Final Goal Check contains a table mapping every acceptance criterion to named tests and production `file:line` evidence.
* [ ] #4 The deterministic certification fixture's expected values are hand-computed and reviewed for circular assertions.
* [ ] #5 Board/FLOW and shared CLI statistics agree on repository identity, completed-mission population and shared metric semantics.
* [ ] #6 Missing measurement coverage remains visible all the way to presentation.
* [ ] #7 No compatibility façade, duplicate calculation path or temporary statistics abstraction remains from this mission.
* [ ] #8 Repository-wide search confirms obsolete semantics/comments have been removed or updated.
* [ ] #9 No focused tests or unannotated skipped tests were introduced.
* [ ] #10 Lint and static analysis are clean for every changed file.
* [ ] #11 `./scripts/verify-local.sh all` ran on the final tree and the actual command/output status is captured in task evidence.
* [ ] #12 The mission is not marked done if the production-path certification test is absent, skipped or only exercises manually constructed BoardMetrics.

---

# Final Goal Check format

Before marking the mission complete, include this exact evidence table in the mission checkpoint/final report:

| AC  | Result    | Production evidence | Regression test | Why the test would catch the old bug |
| --- | --------- | ------------------- | --------------- | ------------------------------------ |
| #1  | PASS/FAIL | file:line           | test name       | concrete explanation                 |
| ... | ...       | ...                 | ...             | ...                                  |

Do not use:

* “implemented”
* “covered”
* “looks correct”
* “tests pass”

as evidence without naming the concrete source and test.

Any acceptance criterion lacking evidence remains **FAIL** and the mission remains incomplete.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

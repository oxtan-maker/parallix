# Mission: Make statistics trustworthy for experiment comparison (TASK-2357)

## Authority and outcome

This mission closes seven statistics correctness defects and replaces the
TASK-2353 helper-level certification. Statistics decide whether Parallix
experiments improve delivery; fabricated measurements, repository mixing,
future historical information, and competing completion populations are
correctness failures, not presentation defects.

The production path that must be repaired and certified is:

```text
authoritative persisted facts
  → production composition and canonical repository identity
  → ConcreteMetricsReadAdapter
  → shared mission-flow/cohort semantics
  → BoardMetrics, FLOW, and px stats
```

Do not redesign the statistics subsystem. Repair the existing path with the
smallest coherent changes, then prove its observable results from independent,
hand-computed fixture facts.

TASK-2355's production-composition fixture requirement is absorbed here. Once
this mission is complete, mark TASK-2355 superseded by TASK-2357; do not leave
two competing certification missions.

## Non-negotiable semantic decisions

These are requirements, not implementation options.

1. For mission-flow statistics, completion is the authoritative lifecycle entry
   into `done`. A lifecycle-completed mission with no telemetry is completed;
   a telemetry-bearing mission that never reached `done` is not completed.
   Board, cohort membership, and shared CLI mission-flow reports use exactly
   that population. A genuinely telemetry-only report may remain only when it
   is explicitly named telemetry and does not present a competing completed-
   mission count.
2. Unknown `reviewFixRounds` remains unavailable end-to-end. It is never
   converted to zero. A known zero remains a real measurement distinct from
   unknown.
3. A worktree path, working directory, package name, basename, or arbitrary
   absolute path is never the final repository identity. Reuse the existing
   canonical owning-repository resolution used by mission composition; do not
   introduce another identity owner.
4. A mission is absent from historical cumulative flow before authoritative
   intake. Do not infer intake from `from === to` or an accidental
   normalization shape. Preserve or derive explicit intake/initial-entry
   identity from authoritative data. Current Mission state must not seed a
   fully reconstructable prior history.
5. A repository-scoped legacy history fallback never guesses from a row in a
   second repository. If safe disambiguation is impossible, return
   unavailable/legacy-unknown rather than cross-contaminating data.
6. Given known lifecycle activity, zero completions in a week is measured zero,
   not unavailable. A previous nonzero week must not leak into a current zero
   week. No lifecycle activity may remain unavailable.
7. Each metric's coverage and low-sample judgement uses its own observation
   count, not cohort population.

Never silently collapse:

```text
unknown → 0                 unavailable → 0
legacy → current state      no telemetry → not completed
worktree path → repository identity
closed=yes telemetry → lifecycle completion
```

## Scope: defects and required examples

### A. Historical pre-intake leakage

With A intaked Monday and B intaked Thursday, with B reaching `done` today,
historical flow must show B absent Monday through Wednesday and `backlog` on
Thursday. The regression must persist real lane events and traverse the real
adapter conversion; manually creating a transition with `from: null` cannot
certify this defect.

### B. Canonical repository identity

Create a temporary real Git primary checkout and a real Git worktree for it.
With no explicit `--repo` override, lifecycle writes, lane reads, measurements,
BoardMetrics, cohorts, `px stats cohorts`, and shared `px stats` mission-flow
reports must resolve one identical canonical RepositoryId from both locations.
Add an unrelated repository with an overlapping mission ID to prove isolation.

### C. Unknown review-fix rounds

Use at least four missions: known rounds `0`, known rounds `2`, and two
unknown values. Expected population is four; observation count is two; only
`[0, 2]` contributes to displayed aggregate values. Prove an unknown value is
stored as SQL NULL (or the established unavailable representation) in real
SQLite, then read it through normal adapters to presentation. Audit remaining
equivalents of `?? 0`, `|| 0`, and numeric parsing fallbacks for this field;
retain one only with a proved known-value guarantee.

### D. One completion population

Fixture: A reached `done` with telemetry; B reached `done` without telemetry;
C has telemetry but did not reach `done`. The completed population is exactly
`A, B`, for BoardMetrics, cohorts, and shared CLI mission-flow statistics.
Execution/token/cost for B may remain unavailable. Renaming output without
converging these shared calculations does not satisfy this mission.

### E. Repository-scoped legacy fallback

Create repo A/TASK-123 and repo B/TASK-123 with distinct candidate legacy
timestamps and incomplete lane history. Stats for each repository must select
only its own timestamp.

### F. Measured zero throughput

With twelve lifecycle-active missions and no completed outcomes, current-week
throughput is exactly `0`. Also prove a prior week of `7` and a current week of
`0` renders current week as `0`. Use the injected deterministic projection
clock.

### G. Metric-specific evidence

With cohort population 30 and metric observations cycle-time 30, review dwell
18, runtime 14, cost 2, the cost metric must be low-sample according to the
same shared threshold/representation used by the consumer. Cohort population
remains distinct from metric observation count.

## Certification boundary and independent oracle

The final certification replaces the former helper test and absorbs TASK-2355.
It must use all of the following:

- temporary real Git primary repository and real Git worktree;
- second unrelated repository with colliding mission ID;
- actual migrated SQLite database and real persistence repositories/adapters;
- production canonical identity resolution;
- `ConcreteMetricsReadAdapter` and `BoardProjectionBuilder`, preferably
  production composition;
- default-resolution CLI cohort and statistics entry points;
- injected deterministic clock; and
- hand-computed expected values adjacent to the fixture.

It must contain earlier and later intake, lifecycle-completed with and without
telemetry, telemetry without lifecycle completion, known zero/nonzero/unknown
review-fix rounds, review bounce and no-bounce, previous-week completions plus
current zero week, partial runtime/token/cost/NEL coverage, two experiment
labels, a non-UTC source timestamp, and per-repository legacy fallback cases.

Do not certify with manually created `MissionTransition[]`, `MissionOutcome[]`,
or `BoardMetrics`; mocks of the semantic seams; direct `buildMetrics()`; or
expected values calculated through production statistics, bucketing,
percentile, repository-resolution, or lifecycle-reconstruction helpers.
Focused unit tests may use those techniques, but the certification may not.

Assert exact, hand-computed lane populations, absence before intake, throughput,
completed population, cycle-time values, bounce rate/population, review-fix
values/counts, runtime/token/cost counts, cohort membership, metric evidence,
repository identity, cross-repository isolation, and Board/CLI agreement.
Never accept only existence, non-null, numeric type, or a whole-object snapshot.

## Execution rules

1. Before production edits, record `BASELINE_SHA=$(git rev-parse HEAD)` and
   the complete working-tree state in CP-0. All red evidence identifies that
   SHA. Do not call a failure pre-existing without baseline proof.
2. For every defect A–G: trace the production call path and authoritative
   facts; create or identify a bug-sensitive regression; run it red before
   changing the relevant production code; record expected, actual, and why the
   former behavior fails; make the smallest coherent change; rerun green. If a
   defect is already fixed at baseline, do not churn it: prove the invariant,
   cite the implementation, and mark it already satisfied at baseline.
3. After each critical fix A–D is green, temporarily restore the former
   behavior, run the targeted regression and capture its failure, immediately
   restore the correct implementation, and confirm green. Do not commit the
   intentional breakage.
4. Do not add a second statistics service, cohort pipeline, MissionOutcome
   representation, repository resolver, persistence model, or Board/CLI
   completion definition. A genuinely necessary abstraction must replace all
   duplicate owners in this mission and remove the obsolete owner.
5. Do not use permissive fallbacks to make tests green (`value ?? 0`,
   `value || 0`, `catch { return [] }`, `history ?? currentState`, or
   `repoId ?? process.cwd()`) unless that precise fallback is an explicitly
   documented domain value and has a regression proving it.
6. Do not add test-only production exports. Expose a seam only when it is a
   real architectural boundary, with justification in the checkpoint.
7. No broad cleanup: no unrelated renames, formatting, folder reorganization,
   generic utilities, lifecycle redesign, unrelated docs, or board layout work.
   If production changes substantially exceed named seams, stop and explain
   before continuing. Tests may be larger because certification is in scope.

## Checkpoints

- CP-0: baseline SHA, working tree, relevant tests, production call graph for A–G, and classified searches for intake-null handling, identity derivation, null-to-zero coercion, telemetry completion, unscoped history reads, initial state, and low-sample logic.
- CP-1: one red regression per still-existing A–G defect; capture test name, expected, actual, and production-bug explanation. No broad implementation before this checkpoint.
- CP-2: fix A and F, plus E only if naturally coupled; focused tests green.
- CP-3: fix B and D using the real primary/worktree/cross-repository fixture.
- CP-4: fix C and G; prove real SQLite storage and readback.
- CP-5: replace helper-level certification with the required fixture. Any retained helper test is honestly named.
- CP-6: demonstrate former A–D behavior fails the new regressions, then restore green.
- CP-7: inspect every remaining suspicious semantic match; remove it or document why it is semantically distinct and valid.
- CP-8: run `git diff --check`, all focused tests, certification, and `./scripts/verify-local.sh all`.

Defects A–D each receive their own checkpoint commit; do not combine them.

Each checkpoint document contains a `## Goal Check` table with criterion,
production evidence, test evidence, status, and a non-generic next action.
Evidence names real files/lines, commands, and test names; numeric assertions
state their expected values. Generic claims such as “implemented”, “covered by
tests”, or “all tests pass” are not evidence.

## Acceptance criteria

- [ ] AC01 Baseline SHA and known working-tree state are captured before edits.
- [ ] AC02 Each still-existing defect A–G has a red regression before its fix.
- [ ] AC03 Missions are absent from historical flow before authoritative intake.
- [ ] AC04 Intake identity is explicit; no self-transition heuristic is used.
- [ ] AC05 Reconstructable histories are not seeded from current Mission state.
- [ ] AC06 Legacy history fallback is explicit and repository-scoped.
- [ ] AC07 Primary checkout and worktree resolve the same RepositoryId everywhere.
- [ ] AC08 A colliding mission ID in a second repository cannot contaminate stats.
- [ ] AC09 No normal stats entry point uses cwd or a path as final identity.
- [ ] AC10 Unknown review-fix rounds survive producer → SQLite → adapter →
  outcome → cohort → presentation.
- [ ] AC11 Known review-fix rounds of zero remain distinct from unknown.
- [ ] AC12 Unknown review-fix values affect neither aggregates nor observation count.
- [ ] AC13 Lifecycle entry into `done` defines mission-flow completion.
- [ ] AC14 A lifecycle-completed, telemetry-free mission remains completed in
  BoardMetrics, cohorts, and shared CLI mission-flow statistics.
- [ ] AC15 Telemetry without lifecycle completion does not count as completion.
- [ ] AC16 Board and CLI share exactly the same mission-flow completed population.
- [ ] AC17 Any retained telemetry-only report is explicitly separate from mission flow.
- [ ] AC18 Current-week zero completion is rendered/calculated as measured zero.
- [ ] AC19 A previous nonzero week cannot leak into current-week zero.
- [ ] AC20 Per-metric low-sample/coverage uses that metric’s observation count.
- [ ] AC21 Cohort population remains distinct from metric observation count.
- [ ] AC22 Certification uses migrated SQLite and real persistence adapters.
- [ ] AC23 Certification reaches ConcreteMetricsReadAdapter and
  BoardProjectionBuilder through production boundaries.
- [ ] AC24 Certification exercises default canonical identity from primary and worktree.
- [ ] AC25 Expected certification values are independently hand-computed.
- [ ] AC26 Certification asserts exact populations/values, not existence or type.
- [ ] AC27 Critical A–D regressions fail under temporary former behavior.
- [ ] AC28 No parallel statistics, cohort, or identity architecture remains.
- [ ] AC29 No new unknown-to-zero, current-state, or default-data fallback remains.
- [ ] AC30 TASK-2355 is marked superseded only after its fixture requirement is
  actually satisfied here.
- [ ] AC31 Documentation reflects the final semantics without overstating proof.
- [ ] AC32 `git diff --check` passes.
- [ ] AC33 `./scripts/verify-local.sh all` passes.
- [ ] AC34 No `.only` or unannotated `.skip` is introduced.
- [ ] AC35 Final Goal Check maps every AC to implementation, named test, and an
  explanation of why former behavior fails.

## Stop rules and exclusions

Stop for human direction if nullable `reviewFixRounds` requires schema/database
migration; canonical identity would change persisted RepositoryIds; completion
convergence requires changing persisted measurement-row format; defect A drops a
mission with authoritative intake; or the certification passes against baseline.

Out of scope: general statistics/SQLite/CLI/ports-and-adapters cleanup, new
metrics or experiment dimensions, statistical significance/winner selection,
charting, lifecycle redesign, unrelated malformed-timestamp or clock work,
performance work, historical data rewrites, and changes to verification scripts
or configuration to make gates pass.

## Definition of done

Before marking done, publish a Goal Check row for every AC with: real production
evidence; named regression/certification evidence; and why that test fails under
the former bug. The mission is incomplete if any production-composition fixture
is missing/skipped, identity is manually injected, the lifecycle-done/no-
telemetry case is absent, unknown review-fix rounds lack real DB round-trip
proof, later intake/colliding IDs are absent, expected values use production
helpers, or critical former behavior cannot be shown to break its regression.

The final operator answer must be evidence-backed: experiments run from
different worktrees, with missing telemetry, unknown review-fix counts, and low
cost coverage can be compared without repository mixing, fabricated zeroes,
future historical information, or conflicting completion definitions.

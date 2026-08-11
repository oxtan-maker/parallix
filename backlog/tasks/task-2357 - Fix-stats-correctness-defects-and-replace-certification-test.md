---

id: TASK-2357
title: Close the remaining statistics correctness defects and certify the real production path
status: active
assignee: [claude]
created_date: 2026-08-10 00:00
labels: [bug, user_value, stats, correctness]
labels:

* bug
* stats
* correctness
* ai_sdlc
  priority: high
  dependencies:
* TASK-2353
  references:
* backlog/tasks/task-2355 - Add-production-composition-statistics-fixture.md
* src/application/projections/metrics.ts
* src/application/projections/metrics-read-adapter.ts
* src/application/projections/cohorts.ts
* src/application/projections/board.ts
* src/application/projections/board-readers.ts
* src/application/services/statistics-service.ts
* src/composition/application-services.ts
* src/composition/production-capabilities.ts
* src/adapters/cli/commands/stats.ts
* src/adapters/cli/commands/stats-cohorts.ts
* src/adapters/sqlite/
* src/interfaces/tui/flow-panel.tsx
* docs/authority-reference.md
* test/

---

## Description

Close the remaining correctness defects in Parallix mission statistics after TASK-2347 and TASK-2353.

Statistics are used to decide whether Parallix experiments improve mission delivery. The remaining bugs are therefore correctness bugs, not dashboard polish.

This mission owns exactly these residuals:

1. historical cumulative flow can contain missions before intake;
2. statistics entry points can still resolve the same worktree/repository to different repository IDs;
3. unknown `reviewFixRounds` can become fabricated zero measurements;
4. CLI and board can still disagree about whether a mission completed;
5. legacy lifecycle fallback can cross repository boundaries;
6. zero completed missions can become "unavailable" instead of measured zero;
7. low-sample warnings can use cohort population instead of the metric's actual observation count;
8. the previous certification fixture did not prove the production path strongly enough.

**Do not redesign the statistics subsystem.**

Repair the existing path and prove it:

```text
authoritative persisted facts
        ↓
production composition
        ↓
ConcreteMetricsReadAdapter
        ↓
shared statistics semantics
        ↓
BoardMetrics / cohorts
        ↓
FLOW + px stats
```

The mission is complete only when that real path is certified using independently hand-computed expected values.

---

# Scope consolidation

TASK-2355's production-composition statistics fixture is absorbed into this mission.

Do not implement TASK-2355 separately.

When TASK-2357 lands, update TASK-2355 as superseded by TASK-2357 rather than leaving two competing certification missions.

---

# Non-negotiable anti-slop execution contract

These rules are part of the acceptance criteria.

## Guard 1 — pin the starting tree

Before modifying code:

```bash
git rev-parse HEAD
git status --short
```

Record:

```text
BASELINE_SHA=<sha>
```

in the first checkpoint.

All red-baseline evidence must refer to this SHA.

Do not describe a failure as "pre-existing" without showing that it exists at `BASELINE_SHA`.

---

## Guard 2 — reproduce before fixing

For every defect below:

1. trace the production call path;
2. identify the authoritative source data;
3. add or identify a regression that exposes the defect;
4. run it before changing the relevant production code;
5. record the failing assertion/output;
6. make the smallest coherent correction;
7. rerun the same test;
8. record the passing result.

If a defect is already fixed at `BASELINE_SHA`:

* do not rewrite that code;
* add/identify the regression proving the invariant;
* cite concrete `file:line` evidence;
* mark that defect "already satisfied at baseline".

Do not manufacture churn merely because the mission description predicted a bug.

---

## Guard 3 — production-boundary proof is mandatory

Helper-level tests may support the implementation but cannot certify it.

The final certification must instantiate the real production statistics path, including at minimum:

```text
real migrated SQLite database
        ↓
real persistence adapters
        ↓
production repository identity resolution
        ↓
ConcreteMetricsReadAdapter
        ↓
BoardProjectionBuilder / production composition
        ↓
BoardMetrics consumed by FLOW
```

Prefer exercising `composeProductionCapabilities` directly.

Do not substitute:

* manually created `MissionTransition[]`,
* manually created `MissionOutcome[]`,
* manually constructed `BoardMetrics`,
* mocks of the semantic seams being tested,
* direct calls to `buildMetrics()`,

for the production certification.

Those are allowed only as additional focused unit tests.

---

## Guard 4 — expected values must be an independent oracle

Expected statistics in the certification fixture must be hand-computed from the fixture source facts.

Do not calculate expected values by calling:

* `buildMetrics`,
* `compareCohorts`,
* production percentile helpers,
* production bucketing helpers,
* production repository resolvers,
* production lifecycle reconstruction.

The test must not compare the implementation with itself.

Keep the expected values visibly adjacent to the fixture or in a plainly named constant such as:

```ts
const EXPECTED = {
  ...
};
```

Include comments showing the arithmetic for non-obvious values.

---

## Guard 5 — no architecture wave

Do not introduce:

* a second MissionOutcome representation,
* another statistics service,
* another cohort pipeline,
* another repository identity abstraction,
* another persistence model for stats,
* a board-specific completion definition,
* a CLI-specific completion definition.

If a new abstraction is genuinely required, it must:

1. own semantics currently duplicated in at least two places;
2. replace those duplicate owners in this mission;
3. delete the obsolete implementation in the same mission.

No transitional façade may remain.

---

## Guard 6 — preserve semantic distinctions

Never silently collapse:

```text
unknown       → 0
unavailable   → 0
legacy        → current state
no telemetry  → not completed
worktree path → repository identity
fix rounds    → review bounce rate
closed=yes    → lifecycle completion
```

If information is unknown, keep it unknown.

If a fallback is used, expose that it is a fallback.

---

## Guard 7 — no permissive fallback introduced to make tests green

Do not solve failures with constructs such as:

```ts
value ?? 0
value || 0
catch { return [] }
catch { return defaultMetrics }
repoId ?? process.cwd()
history ?? currentState
```

unless zero/default/current-state is the explicitly documented domain value for that exact condition.

Any new fallback requires a regression proving why it is semantically correct.

---

## Guard 8 — no intake heuristics based on self-transitions

Do not fix historical reconstruction by assuming:

```text
from === to
```

means intake.

Self-transitions can have other meanings, including administrative closure.

The statistics path must preserve or derive **explicit intake/initial-entry identity** from authoritative data.

Valid approaches include preserving nullable `fromStatus`, event kind/trigger, or another existing authoritative intake discriminator.

Do not infer intake from an accidental shape produced by normalization.

---

## Guard 9 — one repository identity owner

Do not add another function that independently derives repository identity.

Find the existing canonical owning-repository resolution used by Mission composition and reuse it.

The following are not valid default repository identities:

```text
process.cwd()
rootDir
worktree basename
package.json product name
arbitrary absolute path
```

unless they are inputs to the canonical resolver rather than the final identity.

Explicit user `--repo` override may remain if intentionally supported.

---

## Guard 10 — lifecycle completion wins

For **mission-flow statistics**, completion means authoritative lifecycle entry into `done`.

Do not take the easy route of merely renaming `px stats` output while leaving two incompatible mission-completion populations.

If a CLI report is genuinely about raw agent telemetry, it may remain telemetry-specific, but:

* it must be explicitly identified as telemetry;
* it must not provide a competing "completed missions" count;
* mission throughput/cycle/cohort statistics must use lifecycle completion.

Board and CLI must observe the same completed mission population for shared mission statistics.

---

## Guard 11 — nullability must survive every layer

For `reviewFixRounds`, prove all of these separately:

```text
producer
  ↓
persistence write
  ↓
SQLite value
  ↓
persistence read
  ↓
domain outcome
  ↓
cohort aggregation
  ↓
BoardMetrics
  ↓
FLOW / CLI
```

Unknown must remain `null`/unavailable through the complete chain.

A known zero remains a genuine zero.

Do not accept a test that proves only the producer emits null.

---

## Guard 12 — no broad cleanup

Do not:

* rename unrelated files;
* reorganize folders;
* reformat large untouched files;
* update unrelated documentation;
* introduce generic utility libraries;
* clean unrelated ports/adapters;
* modify lifecycle states;
* modify board layout beyond what the correctness fix requires.

If the production diff grows substantially beyond the named seams, stop and record why before continuing.

Tests may be larger than production changes because certification is a major goal of this mission.

---

## Guard 13 — tests must be bug-sensitive

For every critical defect, answer:

> Why would this exact test fail if the old bug were reintroduced?

If there is no concrete answer, the regression is insufficient.

Assertions such as these are not certification:

```text
series.length > 0
value != null
typeof value === "number"
cohorts exist
output contains "stats"
```

Assert exact expected values/populations.

---

## Guard 14 — mutation/reversion proof for critical defects

After each critical fix is green, temporarily reproduce the old implementation behavior and run its regression.

At minimum do this for:

1. historical pre-intake leakage;
2. repository worktree identity;
3. `reviewFixRounds` null→0;
4. lifecycle completion without telemetry.

The targeted test must fail.

Restore the correct implementation immediately afterward and confirm the test passes again.

Do not commit the intentionally broken mutation.

Record the command and failure in checkpoint evidence.

---

## Guard 15 — no test-only production hooks

Do not add exported production functions solely to make tests easier.

Prefer testing through existing public/application composition boundaries.

If a seam must be exposed, justify why it is an actual architectural boundary rather than a test convenience.

---

# Defect A — historical missions must not exist before intake

## Problem

Historical cumulative-flow reconstruction can still seed a mission using today's current state before that mission's intake event.

The attempted detection based on:

```ts
transition.from === null
```

is insufficient if persistence-to-domain conversion has already normalized nullable intake source state.

## Required semantics

Given:

```text
Task A
Mon 09:00 intake → backlog
Tue 10:00 backlog → active

Task B
Thu 09:00 intake → backlog
Fri 10:00 backlog → active
Sat 11:00 → done

today:
A = active
B = done
```

historical state must be:

```text
Mon 12:00
A backlog
B ABSENT

Tue 12:00
A active
B ABSENT

Wed 12:00
A active
B ABSENT

Thu 12:00
A active
B backlog
```

Task B must not count in any lane before Thursday.

## Constraints

* preserve explicit intake information through the projection path;
* do not infer intake from `from === to`;
* do not seed reconstructable histories from current Mission status;
* legacy histories may use an explicit fallback only when actual lifecycle history is incomplete.

## Regression

The test must pass through persisted lane events and the real adapter conversion.

A manually constructed transition with `from: null` is not sufficient.

---

# Defect B — canonical repository identity on every stats path

## Problem

Mission/board composition and CLI statistics can still derive repository IDs differently, especially from worktrees.

## Required semantics

Create a real temporary Git repository:

```text
<tmp>/parallix
```

and a real Git worktree:

```text
<tmp>/parallix-task-2357
```

Run statistics entry points from both locations with **no explicit `--repo` override**.

All must resolve the same canonical repository ID:

* Mission lifecycle writes;
* lane-event reads;
* measurement writes/reads;
* BoardMetrics;
* cohort calculations;
* `px stats cohorts`;
* shared `px stats` mission-flow statistics.

Add a second unrelated repository containing an overlapping mission ID to prove repository scoping remains intact.

## Constraints

* reuse one existing canonical resolver;
* no `process.cwd()` as repository identity;
* no absolute worktree path as repository identity;
* no broad `findAll()` plus accidental cross-repository filtering;
* do not "fix" this by removing repository scoping.

## Static search evidence

At final checkpoint, inspect all stats entry points for independent identity derivation.

Every remaining derivation must be justified.

---

# Defect C — `reviewFixRounds`: unknown is not zero

## Required fixture

At least:

```text
Mission A: known reviewFixRounds = 0
Mission B: known reviewFixRounds = 2
Mission C: reviewFixRounds unknown
Mission D: reviewFixRounds unknown
```

Expected:

```text
population = 4
reviewFixRounds observations = 2
known values = [0, 2]
```

Whatever aggregate is displayed must use only those two measurements.

Unknown values must not:

* enter averages/medians as zero;
* increase `observationCount`;
* cause false low/high sample interpretation.

## Persistence proof

After write, query the actual SQLite row and prove unknown is stored as SQL NULL or the existing equivalent unavailable representation.

Then read through the normal adapter and prove it remains unavailable.

## Forbidden patterns

Any remaining equivalent of:

```ts
pr_fix_rounds ?? 0
reviewFixRounds ?? 0
parseInt(value) || 0
Number(value) || 0
```

must be audited.

A remaining occurrence is acceptable only if the value is guaranteed known at that layer and that guarantee is proven.

---

# Defect D — one completion population for mission-flow stats

## Required fixture

Include:

```text
Mission A:
lifecycle → done
usage telemetry complete

Mission B:
lifecycle → done
NO usage telemetry

Mission C:
usage telemetry present
lifecycle NOT done
```

Expected completed mission population:

```text
A, B
```

not:

```text
A only
```

and not:

```text
A, B, C
```

The same population must be observed by:

* BoardMetrics mission-flow statistics;
* cohort membership;
* CLI mission throughput/completion statistics.

Execution/token/cost metrics for B may remain unavailable.

## Constraint

Do not satisfy this AC merely by changing user-facing wording.

The lifecycle authority must actually be shared by mission-flow calculations.

Telemetry-specific reports may still exist separately.

---

# Defect E — legacy fallback must remain repository scoped

## Required fixture

Create:

```text
repo A / TASK-123
repo B / TASK-123
```

Give the legacy/incomplete-history fallback different candidate timestamps in the two repositories.

Statistics for repo A must never consume repo B's fallback row.

## Preferred behavior

Use a repository-scoped query.

If legacy history genuinely lacks sufficient repository identity to disambiguate safely, return unavailable/legacy-unknown rather than guessing from another repository's record.

Do not cross-contaminate in order to preserve a value.

---

# Defect F — zero completions is a measured zero

## Required semantics

With a known repository and lifecycle population:

```text
12 active/refined/review missions
0 completed missions ever
```

current weekly completions are:

```text
0
```

not unavailable.

Similarly:

```text
last week = 7
current week = 0
```

must display:

```text
current week = 0
```

not `7`.

Missing telemetry must not change that because throughput uses lifecycle completion.

Use the injected projection clock.

---

# Defect G — low-sample status follows each metric's evidence

Given:

```text
cohort population = 30
cycle-time observations = 30
review-dwell observations = 18
runtime observations = 14
cost observations = 2
```

the UI/contract must not represent cost as well-supported merely because the cohort contains 30 missions.

Low-sample/coverage semantics must be based on each metric's own observation count.

Prefer one common evidence representation rather than fields such as:

```text
costLowSample
runtimeLowSample
tokenLowSample
...
```

Do not duplicate threshold logic across CLI and FLOW.

---

# Production certification fixture

This replaces the previous helper-level certification and absorbs TASK-2355.

## It must use

* temporary real Git primary repository;
* real Git worktree;
* second unrelated repository;
* actual migrated SQLite database;
* real repositories/adapters;
* production repository identity resolution;
* production metrics adapter;
* production BoardProjectionBuilder;
* preferably `composeProductionCapabilities`;
* CLI cohort/statistics entry point using default repository resolution;
* injected deterministic clock.

## It must contain

At least:

1. repo A and repo B with overlapping mission IDs;
2. primary checkout and worktree for repo A;
3. mission intaked earlier;
4. second mission intaked several days later but done today;
5. lifecycle-completed mission with full telemetry;
6. lifecycle-completed mission with no telemetry;
7. telemetry-bearing mission not lifecycle-completed;
8. known zero review-fix rounds;
9. known non-zero review-fix rounds;
10. unknown review-fix rounds;
11. review → active bounce;
12. reviewed mission with no bounce;
13. previous-week completions;
14. zero-completion current week;
15. partial runtime/token/cost/NEL coverage;
16. at least two canonical experiment labels;
17. non-UTC source timestamp;
18. legacy/incomplete-history case scoped to each repository.

## Assertions

Assert exact hand-computed:

* historical lane population at multiple timestamps;
* absence of missions before intake;
* current-week throughput;
* completed mission population;
* lifecycle cycle-time values;
* review bounce population/rate;
* review-fix value and observation count;
* runtime/token/cost observation counts;
* cohort membership;
* per-metric low-sample state;
* repository identity;
* cross-repository isolation;
* BoardMetrics/CLI agreement for shared mission-flow statistics.

Do not merely snapshot the entire object.

Use focused exact assertions so failures identify the broken invariant.

---

# Required checkpoints

## Checkpoint 0 — inventory

Record:

```text
BASELINE_SHA
working-tree status
relevant current tests
production call graph for each defect
```

Also search for known suspicious patterns including:

```text
transition.from === null
process.cwd()
toRepositoryId(rootDir)
product.name
pr_fix_rounds ?? 0
reviewFixRounds ?? 0
|| 0
closed === 'yes'
historyRepo.findAll()
lowSample
initialStates
```

Do not bulk-replace search matches.

Classify each match by semantics.

---

## Checkpoint 1 — red baseline

Create/identify regressions for A–G.

Run them against baseline before the corresponding fix.

For every failing defect capture:

```text
test name
expected
actual
why this demonstrates the production bug
```

No broad implementation work before this checkpoint.

---

## Checkpoint 2 — temporal authority

Fix only:

* historical pre-intake leakage;
* zero-current-week semantics;
* legacy repository-scoped temporal fallback if naturally coupled.

Run focused tests.

No cohort/UI refactor here.

---

## Checkpoint 3 — identity/completion authority

Fix:

* canonical repository resolution;
* board/CLI completion population convergence.

Run the real primary-checkout/worktree/cross-repository fixture.

---

## Checkpoint 4 — measurement evidence

Fix:

* `reviewFixRounds` nullability;
* per-metric low-sample semantics.

Verify actual SQLite storage and readback.

---

## Checkpoint 5 — production certification

Replace the old certification path with the production-composition fixture.

Do not keep the old helper fixture under a name suggesting it is end-to-end certification.

A useful helper test may remain, but name/scope it honestly.

---

## Checkpoint 6 — mutation proof

Temporarily reintroduce old behavior for critical defects A–D one at a time.

Show the relevant regression fails.

Restore correct code and show green again.

No broken mutation may remain in Git history intended for integration.

---

## Checkpoint 7 — contradiction sweep

Search the final tree for obsolete semantics.

Specifically inspect remaining occurrences related to:

* current-state historical seeding;
* independent stats repository-ID derivation;
* unknown reviewFixRounds → zero;
* telemetry `closed=yes` as mission completion;
* unscoped legacy history reads;
* cohort-population-based metric confidence.

For every remaining suspicious match, either:

* remove it; or
* document why its semantics are different and valid.

---

## Checkpoint 8 — final verification

Run:

```bash
git diff --check
./scripts/verify-local.sh all
```

plus every new targeted regression/certification command if not already included in the full verifier.

No `.only`.

No unannotated `.skip`.

No ignored verification failure.

---

# Acceptance Criteria

* [ ] AC01 Baseline SHA and clean/known working-tree state are captured before changes.
* [ ] AC02 Each still-existing defect A–G has a red regression before its production fix.
* [ ] AC03 Missions are absent from historical cumulative flow before authoritative intake.
* [ ] AC04 Intake identity is preserved explicitly; no self-transition heuristic is used.
* [ ] AC05 Fully reconstructable histories are not seeded from today's Mission state.
* [ ] AC06 Legacy history fallback is explicit and repository scoped.
* [ ] AC07 Primary checkout and worktree resolve to the same canonical RepositoryId everywhere.
* [ ] AC08 A second repository with an overlapping mission ID cannot contaminate statistics.
* [ ] AC09 No normal statistics entry point uses `process.cwd()` or an arbitrary worktree path as final repository identity.
* [ ] AC10 `reviewFixRounds = null` survives producer → SQLite → read adapter → MissionOutcome → cohort → presentation.
* [ ] AC11 Known `reviewFixRounds = 0` remains distinguishable from unknown.
* [ ] AC12 Unknown review-fix values do not contribute to aggregate values or observation counts.
* [ ] AC13 Mission-flow completion is lifecycle entry into `done`.
* [ ] AC14 Lifecycle-completed missions without telemetry remain completed in BoardMetrics, cohorts, and shared CLI mission-flow statistics.
* [ ] AC15 Telemetry-bearing but lifecycle-incomplete missions do not count as completed mission flow.
* [ ] AC16 CLI and board observe the same completed population for shared mission-flow statistics.
* [ ] AC17 Any retained telemetry-only reports are explicitly separated from mission-flow completion semantics.
* [ ] AC18 Zero completions in the current week is rendered/calculated as measured zero.
* [ ] AC19 A previous non-zero week cannot leak forward into the current zero week.
* [ ] AC20 Per-metric low-sample/coverage uses that metric's actual observation count.
* [ ] AC21 Cohort population size remains distinct from per-metric observation count.
* [ ] AC22 Certification uses real migrated SQLite and production adapters.
* [ ] AC23 Certification reaches `ConcreteMetricsReadAdapter` and `BoardProjectionBuilder`, preferably via production composition.
* [ ] AC24 Certification exercises real canonical identity from both a primary checkout and Git worktree.
* [ ] AC25 Expected certification values are hand-computed independently of production statistic helpers.
* [ ] AC26 Certification asserts exact values/populations rather than merely existence/type/non-null.
* [ ] AC27 Critical regressions A–D demonstrably fail when the former behavior is temporarily reintroduced.
* [ ] AC28 No new parallel statistics/cohort/repository-identity architecture remains.
* [ ] AC29 No new unknown→zero/current-state/default-data compatibility fallback was introduced.
* [ ] AC30 TASK-2355 is marked superseded by TASK-2357 after its production-fixture requirement is satisfied here.
* [ ] AC31 Documentation reflects actual final semantics and does not claim broader certification than the tests provide.
* [ ] AC32 `git diff --check` passes.
* [ ] AC33 `./scripts/verify-local.sh all` passes on the final tree.
* [ ] AC34 No focused or unannotated skipped tests were introduced.
* [ ] AC35 Final Goal Check maps every AC to concrete production evidence and named tests.

---

# Definition of Done

The mission is **not done** merely because implementation tests are green.

Before setting status to done, produce this table:

| AC   | Result    | Production evidence | Test evidence | Old-bug sensitivity    |
| ---- | --------- | ------------------- | ------------- | ---------------------- |
| AC01 | PASS/FAIL | file:line / command | test/command  | why old behavior fails |
| ...  | ...       | ...                 | ...           | ...                    |
| AC35 | PASS/FAIL | ...                 | ...           | ...                    |

For an AC to be PASS:

1. production evidence must identify the real implementation;
2. test evidence must name the relevant regression/certification test;
3. old-bug sensitivity must explain why that test would fail under the former defect.

Phrases such as:

```text
implemented
covered by tests
looks correct
verified
all tests pass
```

are not sufficient evidence by themselves.

The mission remains incomplete if:

* the production-composition certification test is missing or skipped;
* expected values are derived using production statistics code;
* repository identity is manually injected in the test instead of exercising default worktree resolution;
* the lifecycle-completed/no-telemetry case is absent;
* unknown `reviewFixRounds` does not survive a real database round trip;
* historical reconstruction does not contain a mission intaked later than another mission;
* cross-repository overlapping mission IDs are not exercised;
* the old critical bugs cannot be shown to break their regressions.

---

# Out of Scope

Do not include:

* general statistics redesign;
* new analytics infrastructure;
* new experiment dimensions;
* statistical significance testing;
* automatic experiment winner selection;
* new charting frameworks;
* general SQLite cleanup;
* general CLI cleanup;
* general ports-and-adapters cleanup;
* lifecycle-state redesign;
* malformed-timestamp cleanup unrelated to the named defects;
* unrelated clock refactoring;
* performance optimization.

If an unrelated defect is discovered, record it as a separate backlog candidate rather than expanding this mission.

---

# Final operator question

Before marking done, answer explicitly:

> If experiment A and experiment B ran from different Parallix worktrees, some missions had missing telemetry, some review-fix counts were unknown, and one cohort had low cost coverage, can the operator now compare them without repository mixing, fabricated zero measurements, future historical information, or conflicting definitions of mission completion?

The answer must be supported by the production certification fixture, not by reasoning alone.

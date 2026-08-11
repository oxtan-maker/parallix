---
id: TASK-2363
title: experimation surface
status: review
assignee: [codex]
created_date: '2026-08-11 16:15'
labels: [user_value]
dependencies: []
ordinal: 89913
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make the Parallix operator board (px ui / npm run dev) useful as a weekly experiment-decision surface and close the remaining statistics-integrity gaps found after TASK-2357.

The current operator problem is that FLOW can display lifecycle statistics with very large historical sample sizes (n=200+). That is not useful for rapid product decisions and is particularly unsafe while the database contains historical measurements produced during periods when statistics bugs existed.

Parallix currently completes roughly enough missions each week for a rolling weekly population to be actionable.

The default FLOW decision question should therefore be:

How did missions completed during the last 7 days behave, and how does that compare with the preceding 7 days?

px stats already uses this decision cadence. Do not change its default weekly semantics.

The mission also closes the remaining integrity issues around:

unknown reviewFixRounds,
repository identity for measurement joins,
and production-path statistics certification.

This is a bounded correctness mission.

Do not redesign the statistics architecture.

Primary semantic requirement — one weekly decision population

FLOW's performance/experiment statistics must no longer use all historical completed missions.

Use the same rolling window semantics as default px stats:

CURRENT
today - 6 calendar days  → today
inclusive

PREVIOUS
today - 13 calendar days → today - 7 calendar days
inclusive

Use the existing injected/application clock rather than wall-clock calls hidden inside calculations.

Completed-mission cohort semantics

A mission belongs to a decision window when its authoritative lifecycle delivery-completion timestamp falls inside that window.

For example:

today = 2026-08-11

current:
2026-08-05 → 2026-08-11

previous:
2026-07-29 → 2026-08-04

A mission completed on August 6 belongs to current even if it:

entered backlog in July,
spent several days active,
or contains agent runs from before August 5.

The window selects completed missions, not pieces of their lifecycle.

Once a mission belongs to the window, its full lifecycle and measured agent data may be used to calculate that mission's statistics.

Decision metrics that MUST use the completed-mission window

At minimum:

Lifecycle cycle time

For current and previous windows:

median lifecycle cycle time
n = missions completed in that window with valid lifecycle cycle time

Historical missions outside the selected window must have no effect.

Agent runtime

Use agent runtime belonging to missions completed in the selected window.

Missing runtime remains unavailable and does not become zero.

Lifecycle dwell by state

For missions completed in the selected window, calculate their full closed lifecycle intervals and report at least:

active dwell median,
review dwell median,
integration dwell median where observations exist.

Do not implement this as:

transitions whose timestamps happened during the last 7 days.

That would truncate missions crossing the window boundary.

Correct semantics are:

select mission by completedAt
        ↓
use that mission's complete lifecycle intervals
Review bounce rate

Calculate review-bounce statistics for missions completed in the selected decision window.

The denominator remains the appropriate reviewed-mission population, not every mission and not telemetry review-fix rows.

Experiment cohorts

Default FLOW cohort comparison must be restricted to missions completed in the current rolling 7-day window.

A six-month-old mission carrying the same experiment label must not affect today's experiment comparison.

Keep per-metric observation counts.

Metrics that MUST NOT be blindly windowed

Current operational metrics answer a different question and should remain current-state metrics:

current WIP,
current lane age,
current bottleneck,
current agent availability.

Historical cumulative flow may remain historical.

Do not distort an operational metric merely to make every number say "7 days".

If an existing displayed metric deliberately retains different time semantics, label those semantics clearly in FLOW.

FLOW presentation

Make the decision window visible to the operator.

A suitable presentation is conceptually:

FLOW · decision window 2026-08-05 → 2026-08-11

                               current      previous
Completed missions              n=31          n=28
Lifecycle cycle median         46 min        61 min
Agent runtime median           22 min        24 min
Active dwell median            27 min        35 min
Review dwell median             9 min        17 min
Review bounce rate               16%           29%

CURRENT FLOW

active median age               34 min
review median age               18 min
integration median age           7 min

Bottleneck: active ...

Exact formatting is an implementation detail.

Required UI semantics are:

current rolling-7-day dates are visible;
current metric n is visible;
previous rolling-7-day comparison is visible for the main decision metrics;
historical/lifetime population is not presented as the current decision sample;
current-state flow metrics are visually distinguishable from completed-mission decision metrics.

Do not calculate statistics inside React/Ink.

FLOW formats projection-supplied statistics only.

Critical contaminated-history regression

The fixture MUST contain a large old historical population specifically to prevent regression to cumulative statistics.

Seed at least:

OLD HISTORY
240 completed missions
all completed > 30 days ago
cycle times deliberately extreme, e.g. around 800–1200 min

PREVIOUS WINDOW
28 completed missions
known hand-computed values

CURRENT WINDOW
31 completed missions
known hand-computed values

Choose the numbers so that including the 240 old missions would drastically change both:

median
n

Expected current FLOW cycle-time result must remain based only on:

n = 31

not:

n = 299

or any other cumulative population.

The regression must assert exact values.

A test asserting only n < 240, value != null, or similar is insufficient.

Reuse one weekly-window semantic owner

Do not duplicate seven-day date arithmetic in:

CLI,
metrics.ts,
cohorts,
FLOW.

px stats already has working current/previous seven-day semantics.

The application layer should own the shared decision-window definition used by both CLI and board.

If the current implementation lives only inside the CLI adapter, extract the smallest useful application-level window primitive.

Do not import CLI adapter code into the application layer.

Do not create a generic date/time framework.

The target is one small semantic owner for:

current rolling 7 days
previous rolling 7 days
contains(completedAt)
window labels

Existing px stats output must retain its current behavior after the extraction.

Remaining integrity defect A — unknown reviewFixRounds must remain unknown

reviewFixRounds has three semantically different states:

known zero
known non-zero
unknown

These must remain distinguishable end-to-end.

Required fixture:

Mission A = known 0
Mission B = known 2
Mission C = unknown
Mission D = unknown

Expected:

population n = 4

reviewFixRounds observations:
n = 2
values = [0, 2]

Unknown values must not become:

0
"0"

at any stage.

Trace and prove:

producer
  ↓
measurement write
  ↓
actual SQLite value
  ↓
measurement read
  ↓
MissionOutcome
  ↓
cohort aggregation
  ↓
BoardMetrics
  ↓
FLOW / CLI where displayed

Unknown must remain SQL NULL / semantic unavailable.

A known zero must remain zero.

Audit suspicious constructs around this field, including equivalents of:

?? 0
|| 0
numeric(null) → "0"
parseInt(undefined) → 0

Do not globally alter numeric missing-data handling for unrelated metrics without proof that their semantics are the same.

Remaining integrity defect B — one repository identity for new statistics data

New measurement data and lifecycle data must join using the same canonical repository identity.

A configured display/product name must not silently cause newly written measurement records to use a different identity from Mission lifecycle records.

Required test:

primary checkout:
<tmp>/actual-repository-name

worktree:
<tmp>/task-worktree

configured product.name:
deliberately-different-display-name

New lifecycle and measurement data written from either checkout must still join into the same mission outcomes.

BoardMetrics and px stats cohorts must see the same repository population.

Legacy compatibility

If older persisted telemetry legitimately used a historic product-name identity, preserve access only through an explicit, narrowly scoped legacy/migration strategy.

Do not solve compatibility by continuing to create split identities for new data.

Do not broaden all repository queries.

Do not join solely on mission ID.

Production-composition statistics certification

Add the production-composition certification that previous statistics missions failed to provide strongly enough.

This is an E2E/integration test of the statistics path.

It is explicitly NOT an end-to-end agent mission test.

Absolute prohibition

The certification test MUST NOT:

start Codex;
start Claude;
start Pi;
start Vibe/custom agents;
invoke an LLM;
execute a Parallix mission;
invoke the mission runner;
make network calls;
wait for agent output.

If any agent process is started, the test does not satisfy this mission.

What the test SHOULD do

Deterministically create authoritative facts:

temporary real Git repository
        +
real Git worktree
        +
second repository
        +
real migrated SQLite DB
        ↓
persist lifecycle facts
        ↓
persist measurement facts
        ↓
production composition
        ↓
ConcreteMetricsReadAdapter
        ↓
BoardProjectionBuilder
        ↓
BoardMetrics
        ↓
FLOW rendering and shared px stats semantics

Seed facts directly through production persistence/application adapters.

That is sufficient to test statistics.

Certification fixture contents

The single certification scenario should include at least:

Repository identity
primary repo A;
Git worktree of repo A;
unrelated repo B;
overlapping mission ID between A and B;
deliberately different configured product.name.
Historical contamination
240+ old completed missions outside both weekly decision windows.
Current decision window
roughly 30 completed missions with hand-computed cycle/runtime/dwell values.
Previous decision window
separate completed population with deliberately different values.
Boundaries

At least one mission:

starts before current window but completes inside it;
starts inside current window but remains incomplete;
completes exactly on a window boundary;
completes just outside the window.
Missing telemetry

At least one lifecycle-completed mission with no telemetry.

It contributes to lifecycle completion/cycle statistics where measurable but not runtime/token/cost observations.

Review fixes

Include:

known zero fix rounds;
known non-zero fix rounds;
unknown fix rounds.
Review bounce

Include reviewed missions both with and without real lifecycle review → active bounces.

Partial evidence

Give runtime/cost/token/NEL different observation coverage so n differences are proven.

Hand-computed oracle requirement

Expected results MUST be independent of production statistics functions.

Do not derive expected values with:

production median helpers;
production cohort helpers;
production window helpers;
production repository resolver;
production lifecycle-interval calculation.

Write the expected values explicitly.

For non-trivial medians, list the small current/previous fixture values or show the arithmetic in comments.

The 240 historical missions may be generated programmatically, but expected decision metrics must remain independently specified.

Mandatory baseline before implementation

Before changing production code record:

git rev-parse HEAD
git status --short

Then create/run regressions demonstrating at least:

FLOW cycle-time n includes historical missions;
historical extreme cycle times change the displayed current median;
current and previous decision windows are not available consistently in FLOW;
unknown reviewFixRounds becomes zero anywhere it still does;
product/repository identity divergence exists anywhere it still does;
production certification does not yet reach the required boundary.

If any item is already fixed on the baseline tree:

do not manufacture a failure;
record exact source + test evidence;
leave that implementation alone.
Mandatory old-bug sensitivity

For each critical regression, explain:

What exact former behavior would make this test fail?

At minimum the tests must be sensitive to reintroducing:

all-history cycle median
all-history agent-runtime median
all-history lane dwell
all-history experiment cohorts
unknown reviewFixRounds → 0
measurement repo = product.name while lifecycle repo = canonical repo

Where practical, temporarily reintroduce the old behavior locally and prove the targeted regression turns red, then restore the correct implementation.

Do not commit intentionally broken mutations.

No-agent certification guard

Add a test guard around the production-composition certification so an implementation cannot silently evolve into a real-agent E2E.

Prefer architectural construction that does not even instantiate the agent-launch path.

If the composition object exposes agent capabilities incidentally, do not invoke them.

The certification must complete entirely from deterministic seeded facts.

Document this in the test name/comment, e.g.:

production statistics certification — seeded facts, no agent execution
Anti-slop implementation constraints
Do not solve windowing in the presentation

Forbidden:

FlowPanel filters outcomes
FlowPanel computes median
FlowPanel subtracts 7 days
FlowPanel rebuilds cohort membership

Presentation only renders supplied metrics.

Do not truncate lifecycle intervals at window boundaries

Wrong:

only count dwell occurring between Aug 5 and Aug 11

Correct:

mission completed Aug 5–11
→ use that mission's full lifecycle dwell
Do not filter agent runs by run timestamp

The cohort is selected by mission completion.

A mission completed today may contain an agent run from eight days ago.

Its measured runtime belongs to that mission's completed outcome.

Do not clean historical rows to make the metric look correct

The contaminated old fixture is intentional.

The code must ignore old rows by semantics.

Do not delete/migrate them simply to reduce n.

Do not special-case Parallix repository names

Tests deliberately use mismatched checkout/product names.

Do not introduce another Outcome/Cohort implementation

Extend or parameterize existing statistics functions.

A new representation is acceptable only if it replaces duplicated semantics in the same mission.

Do not change px stats default weekly behavior

The CLI is the reference decision cadence.

Refactoring shared window logic must be behavior-preserving for its default weekly report.

Do not silently convert unavailable to zero

The only relevant deliberate zero in this mission is a genuinely observed zero, such as:

known reviewFixRounds = 0
zero completed missions in a known period

Unknown evidence remains unavailable.

Do not expand into statistical significance

This mission enables short-cycle decisions.

It does not implement p-values, confidence intervals, Bayesian ranking, experiment winner selection, or minimum detectable effect calculations.

Acceptance Criteria

AC01 FLOW has an explicit current rolling-7-day decision window matching default px stats semantics.

AC02 FLOW also exposes the immediately preceding non-overlapping 7-day window for comparison of the main decision metrics.

AC03 Lifecycle cycle-time median uses only missions whose authoritative lifecycle completion is inside the relevant decision window.

AC04 Agent-runtime median uses measured runtime from those same completed missions and does not filter runs individually by run timestamp.

AC05 Lifecycle lane-dwell statistics use full lifecycle intervals belonging to missions completed in the selected decision window.

AC06 Review-bounce statistics use lifecycle behavior of missions completed in the selected decision window.

AC07 Default experiment cohorts in FLOW contain only missions completed in the current rolling 7-day window.

AC08 Current WIP, current lane age, bottleneck and agent availability remain current-state operational metrics rather than being incorrectly windowed.

AC09 The current and previous window date ranges are visible in FLOW.

AC10 Main FLOW decision statistics show their actual observation counts.

AC11 A fixture with 240+ old completed missions leaves the current-window cycle-time n and median completely unchanged.

AC12 The same contaminated-history fixture proves old missions cannot affect current agent-runtime, dwell, bounce or cohort metrics.

AC13 The current-window fixture includes approximately 30 missions and exact hand-computed expected values.

AC14 A mission beginning before the window but completing inside it contributes its complete lifecycle statistics.

AC15 A mission beginning inside the window but not completing does not enter completed-mission decision statistics.

AC16 Current/previous weekly-window semantics have one application-owned definition reused by CLI and board.

AC17 Default px stats weekly behavior is unchanged after shared-window extraction.

AC18 reviewFixRounds unknown remains unavailable through producer → SQLite → read → outcome → cohort → presentation.

AC19 Known reviewFixRounds = 0 remains distinguishable from unknown.

AC20 Unknown review-fix missions do not contribute to review-fix aggregate values or their observation count.

AC21 Newly written measurements use the same canonical repository identity as lifecycle events, including from a worktree.

AC22 Deliberately different product.name does not create a split identity for new measurement/lifecycle data.

AC23 Repo B with an overlapping mission ID cannot contaminate repo A.

AC24 Any required legacy repository alias/migration behavior is explicit and cannot split identity for new writes.

AC25 Production certification uses a real temporary Git primary repository and real Git worktree.

AC26 Production certification uses a real migrated SQLite database and real persistence adapters.

AC27 Production certification reaches ConcreteMetricsReadAdapter, BoardProjectionBuilder, and the BoardMetrics consumed by FLOW.

AC28 Certification renders/asserts FLOW using BoardMetrics produced by that real statistics path rather than manually constructing BoardMetrics.

AC29 Certification checks shared px stats decision-window semantics against the same deterministic fixture where applicable.

AC30 Certification starts no agent, invokes no LLM, executes no mission runner, and makes no network call.

AC31 Certification expected values are hand-computed independently of production statistics helpers.

AC32 Critical assertions use exact values/populations rather than only non-null/type/existence checks.

AC33 Regressions are demonstrably sensitive to the former all-history aggregation behavior.

AC34 Regressions are demonstrably sensitive to unknown-reviewFixRounds→zero behavior.

AC35 Regressions are demonstrably sensitive to split repository identity behavior.

AC36 No new parallel statistics/cohort/outcome architecture remains.

AC37 No statistics calculations were moved into FLOW/React.

AC38 No historical database cleanup is required for the new weekly decision metrics to be correct.

AC39 Documentation states the exact rolling-window semantics and distinguishes completed-mission decision metrics from current-state operational metrics.

AC40 git diff --check passes.

AC41 ./scripts/verify-local.sh all passes on the final tree.

AC42 No focused or unannotated skipped tests were introduced.
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

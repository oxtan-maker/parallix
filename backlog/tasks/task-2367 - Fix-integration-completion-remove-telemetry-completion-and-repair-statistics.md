---
id: TASK-2367
title: 'Fix integration completion, remove telemetry completion, and repair statistics'
status: backlog
assignee: [codex]
created_date: '2026-08-12 09:13'
labels: []
dependencies: []
ordinal: 90913
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Problem

Mission statistics are still not trustworthy because Parallix has two competing representations of completion:

authoritative Mission lifecycle completion;
telemetry closed=yes.

That duplication has already caused repeated implementation errors and incorrect statistics.

Observed production failure:

Before integrating task-2364:
current rolling-7-day lifecycle completions = 5

task-2364 integrates successfully
integration telemetry is written

Immediately afterward:
current rolling-7-day lifecycle completions = 5

The integration-time stats report additionally says:

Mission flow unavailable: lifecycle history was not read.

while running:

npm run dev -- stats

immediately afterward does read lifecycle history.

Current integration code also ties Mission lifecycle completion to backlog-task promotion rather than actual successful integration.

The result can be both:

approved task successfully integrates
→ Mission never reaches done

and:

task still in review
→ Mission reaches done before squash integration has actually succeeded

Fix the write path.

Do not weaken statistics readers to compensate.

Architectural invariant

There is exactly one authority for whether a mission completed:

Mission lifecycle

Specifically:

authoritative transition into done

Telemetry measures agent execution.

Telemetry MUST NOT contain or expose a second mission-completion flag.

After this mission, this relationship must hold:

Mission lifecycle
    │
    │ sole source of completion population
    ▼
completed missions
    │
    ├── lifecycle cycle/dwell/bounce statistics
    │
    └── join telemetry by repository + mission
            │
            └── runtime/tokens/cost/models/fix rounds

There must be no semantic arrow:

telemetry
   └──► mission completed
Part 1 — Remove telemetry closed completely

Remove closed from the contemporary telemetry model.

This is not:

stop using closed in one calculation

It is:

remove the competing concept
Remove from

Audit and remove closed from at least:

telemetry/measurement domain records;
StatsRow contemporary schema;
measurement persistence model;
SQLite measurement schema;
telemetry writers;
telemetry readers;
integration telemetry;
aggregation code;
statistics-service interfaces;
completed-only telemetry helpers;
tests/fixtures;
comments/documentation describing telemetry as closed/open.

Remove generic helpers whose semantics are based on telemetry completion, including equivalents of:

isCompletedStatisticsRow(row)
summarizeCompletedMissionWindow(rows)

when those helpers define completion using row.closed.

The current shared statistics service must no longer have a generic definition equivalent to:

row.closed === 'yes'

for mission completion.

Remove from database

Remove the telemetry closed column from the current SQLite measurement schema.

Use the smallest normal SQLite migration consistent with Parallix migration conventions.

Do not retain the column:

"for compatibility";
"just in case";
hidden behind another DTO;
renamed to completed;
renamed to isFinal;
renamed to missionClosed.

That simply recreates the same footgun.

Integration measurement remains useful

Do not remove integration telemetry itself.

An integration measurement may still record things such as:

stage = integration
implementer
provider/model
runtime
tokens
cost
reviewFixRounds

It just does not state whether the Mission completed.

Mission lifecycle already knows that.

Legacy closed data

Existing closed values may be used once as repair evidence while repairing the current local DB.

They are not authoritative by themselves.

For historical repair, a legacy row such as:

closed=yes

may support a repair only when there is straightforward evidence that integration actually landed.

Preferred evidence:

landed squash/integration commit

with existing completed-task state or legacy closed=yes as corroboration.

After historical repair, live code must not depend on telemetry closed.

Do not build a permanent compatibility API around it.

Legacy CSV import may parse old closed data only if needed to read old files, but it must remain quarantined inside the explicit legacy import boundary and must not enter the contemporary measurement contract.

Part 2 — Fix authoritative integration completion
Current defect

Mission completion is currently coupled to backlog promotion.

The integration command has logic equivalent to:

if backlog task is still review:
    transition Mission using integrate command

Normal integration-ready tasks may already be approved, causing the authoritative Mission transition to be skipped.

The same transition can also occur before the squash integration operation has succeeded.

Both are wrong.

Required sequence

Normal successful integration must become:

preflight
↓
prepare integration
↓
actual squash/integration lands successfully
↓
fresh integration facts established
↓
MissionIntegrationService accepts integration
↓
Mission integration → done persisted atomically
↓
exactly one lifecycle event persisted
↓
integration telemetry recorded
↓
statistics reread authoritative lifecycle + telemetry
↓
report

Mission completion must not depend on whether the Markdown task is:

review
approved
integration
completed

at that point.

Backlog-file state is workflow/presentation state.

It is not delivery authority.

Use the existing MissionIntegrationService

There is already an application service whose integration path persists Mission state plus lane event atomically using saveWithTransition. Use it rather than inventing another completion mechanism.

Do not add:

markMissionDone;
CLI-specific completion SQL;
another integration coordinator;
another lifecycle completion service;
telemetry-based completion fallback.

If the existing service needs a small correction to work at the correct boundary, fix it there.

Successful integration invariant

Starting from the normal production case:

Mission status = integration
backlog task = approved
current rolling-7-day completed population = N

after successful integration:

Mission status = done

integration → done lifecycle events = exactly 1

current rolling-7-day completed population = N + 1

This must work regardless of backlog task already being approved.

Failed integration invariant

If actual integration fails before landing:

Mission status != done

integration → done lifecycle events = 0

completed population remains N

Mission must never be marked done merely because preflight, approval or backlog promotion succeeded.

Resume/idempotency invariant

The integration command supports recovery after partial progress.

If the squash commit has landed but lifecycle closeout was interrupted:

rerun px integrate

must reconcile the missing lifecycle completion.

After recovery:

Mission status = done
integration → done events = 1

Running integration again must leave:

completion events = 1
completed population = N + 1

not:

N + 2
Part 3 — Make integration-time stats and standalone stats identical in semantics

Integration currently renders statistics without reading the same lifecycle population that standalone px stats reads.

Fix that.

Do not duplicate stats logic inside integrate.ts.

Create/reuse one application/reporting boundary that obtains:

authoritative lifecycle completed population
+
telemetry measurements
+
rolling current/previous 7-day windows

and renders the report.

Immediately after integration, these three surfaces must observe the same current completed Mission IDs:

integration-time report

npm run dev -- stats

px ui / BoardMetrics

Formatting may differ.

Population may not.

The integration-time report must not say:

Mission flow unavailable: lifecycle history was not read.

when lifecycle persistence is available.

Part 4 — Preserve weekly FLOW semantics

Do not regress the recent weekly decision-window work.

The main FLOW decision population remains:

current rolling 7 days
today - 6 days through today

compared with:

previous rolling 7 days
today - 13 through today - 7

Mission selection is based on authoritative lifecycle completion.

For a mission completed inside the decision window:

use its full lifecycle
use its full runtime
use its telemetry even if some runs occurred before the window

Do not filter lifecycle intervals or agent runs individually by date.

Old 200+ mission history must not return as the current lifecycle-cycle sample.

Part 5 — Fix reviewFixRounds unknown → zero corruption

Telemetry remains useful for review-fix measurements, but missing measurements must remain missing.

Three states:

known zero
known non-zero
unknown

must remain distinct.

Audit all live paths including:

defaultPrFixRounds
recordActiveStats
recordReviewStats
recordIntegrationStats
measurementToStatsRow
statsRowToMeasurement
telemetry aggregation
cohort aggregation
CLI reporting
BoardMetrics

Remove conversions equivalent to:

unknown ?? 0
unknown || 0
NULL → "0"

for reviewFixRounds.

Required fixture:

Mission A: known 0
Mission B: known 2
Mission C: unknown
Mission D: unknown

Expected:

population = 4

reviewFixRounds observations:
values = [0, 2]
n = 2

Unknown missions do not participate in the average/median.

Verify through actual SQLite write/read.

Part 6 — Keep one canonical repository identity

New lifecycle and telemetry data must use the same repository identity.

Do not use:

product.name
worktree path
process.cwd()

as an independent telemetry repository identity.

Use the same canonical owning-repository resolver used by Mission lifecycle.

A worktree and its primary checkout must join telemetry onto the same Mission.

If legacy rows use an old product-name alias, normalize them during the local DB repair when straightforward.

Do not preserve split identity for new writes.

Part 7 — Repair the current local Parallix database

After fixing production code, repair the actual statistics/lifecycle database currently used by Parallix.

Keep this intentionally simple.

Do NOT build:

backup tooling;
confidence scoring;
generic reconciliation infrastructure;
an interactive repair wizard;
a long-lived repair subsystem.

Use a short task-specific script, command, or direct application code as appropriate.

It only needs to be safe enough to:

repair obvious cases
print ambiguous cases
leave ambiguous cases alone
7A. Repair missing lifecycle completion

Find current-repository missions where integration clearly landed but authoritative lifecycle state/event is missing.

For an obvious affected mission:

Mission not done
and/or
no transition into done

BUT
integration demonstrably landed

repair:

Mission.status = done
missing integration → done event inserted exactly once
completedAt = landed integration timestamp where straightforward

Preserve earlier lifecycle events.

Do not invent intermediate lifecycle history.

Do not create duplicate completion events.

7B. Evidence

Use simple evidence.

Strong evidence:

mission-specific landed squash/integration commit

Legacy telemetry:

closed=yes

may be used as supporting evidence during this one repair, but not by itself if integration cannot be established.

Backlog completed state may also corroborate.

If uncertain:

print mission ID
skip

No confidence framework.

7C. Repair reviewFixRounds

For obviously wrong historical measurements:

if authoritative Review information gives the count, write it;
if no authoritative count exists, store NULL;
remove fabricated zero where it represents unknown.

Do not perform speculative reconstruction.

7D. Repair repository identity

Where old telemetry for this Parallix repo is obviously under a legacy repository alias, normalize it to the canonical ID.

If a uniqueness collision makes the update unclear:

print
skip

Do not build merge machinery.

Ordering requirement for removing closed

Historical closed may be useful for repair evidence.

Therefore the implementation must ensure the real DB can be repaired before that legacy information is made unavailable.

Acceptable approaches include:

repair reads legacy column
↓
repair executes
↓
schema migration removes column

or another equally simple ordering compatible with Parallix migration/runtime mechanics.

Do not retain closed permanently merely because the repair needs temporary access to it.

DB repair report

Print a concise report:

Statistics repair

Lifecycle
  scanned: N
  repaired completion: N
  already correct: N
  skipped ambiguous: N

reviewFixRounds
  corrected known values: N
  fabricated zero → NULL: N

Repository identity
  normalized rows: N
  skipped conflicts: N

Telemetry closed
  removed from contemporary schema: yes

List skipped Mission IDs.

No backup prompt.

No interactive questions.

Part 8 — Verify the real local database

After repair, run the actual Parallix statistics against the repaired DB.

At minimum:

npm run dev -- stats

and inspect the board projection used by:

npm run dev

Record as task evidence:

current rolling-7-day completed Mission count
previous rolling-7-day completed Mission count

current lifecycle cycle median + n
previous lifecycle cycle median + n

current telemetry mission count

reviewFixRounds observation population

Explain any remaining difference between:

completed Mission population
telemetry mission population

Legitimate example:

mission still active but has telemetry

Illegitimate example:

mission successfully integrated but lifecycle completion was never written
Part 9 — No-agent production certification

Add one deterministic integration/statistics certification.

This is an E2E/integration test of the integration → persistence → statistics path.

It MUST NOT:

start Codex;
start Claude;
start Pi;
start any LLM;
execute a Parallix agent mission;
call the mission runner;
use the network.

Use seeded deterministic facts and a temporary repository.

Real components

Exercise as much of the real production path as practical:

temporary Git primary checkout
real Git worktree
real migrated SQLite DB
Mission persistence
lane-event persistence
measurement persistence
MissionIntegrationService
ConcreteMetricsReadAdapter
BoardProjectionBuilder
weekly stats report

Do not manually manufacture final BoardMetrics.

Certification scenario A — normal successful integration

Initial:

Mission = integration
Backlog task = approved
completed current-window population = N

Execute deterministic successful integration closeout.

Assert:

Mission = done

integration → done events = 1

telemetry integration measurement exists

telemetry measurement contains NO closed/completed flag

integration report completed population = N + 1

standalone px stats population = N + 1

BoardMetrics population = N + 1

Assert the exact Mission ID is present.

Certification scenario B — failed integration

Force actual integration to fail before authoritative completion.

Assert:

Mission != done

integration → done events = 0

no completion is visible in statistics

population = N

Telemetry must not be capable of changing that answer.

Certification scenario C — resume

Seed:

integration landed
lifecycle completion missing

Exercise normal resume/retry.

Assert:

Mission = done
completion events = 1
population = N + 1

Retry again:

completion events remains 1
population remains N + 1
Certification scenario D — telemetry cannot complete a Mission

This is an important slop guard.

Create:

Mission lifecycle = integration
telemetry exists

Even if the test uses a legacy fixture containing:

closed=yes

the contemporary statistics result must be:

Mission NOT completed

until authoritative lifecycle completion exists.

After the schema migration, contemporary measurement APIs must not allow a caller to create closed=yes at all.

This test protects against reintroducing telemetry completion semantics later.

Baseline checkpoint

Before changes:

git rev-parse HEAD
git status --short

Capture current evidence for one recent affected mission, preferably task-2364 or another recent integration:

Mission status
lane events
backlog task state
landed integration commit
telemetry measurements
current px stats population

Prove the observed current bug before fixing it.

Mandatory red regressions before production fix

Where still reproducible, create failing regressions for:

approved Mission integrates but lifecycle does not become done;
Mission can become done before integration landing succeeds;
integration-time report does not read lifecycle mission flow;
unknown reviewFixRounds becomes zero;
telemetry closed can be used as a completion concept.

Do not perform broad implementation changes before these red cases exist.

If latest source already fixed a defect:

record evidence
do not manufacture code churn
Anti-slop constraints
No second completion concept

After this mission, searches for contemporary semantics equivalent to:

telemetry.closed
isCompletedStatisticsRow
closed === 'yes'
measurement completed flag

must not produce live mission-completion logic.

Legacy import/repair code is the only acceptable exception and must be clearly labelled legacy.

No renamed telemetry completion flag

Do not replace:

closed

with:

completed
final
finished
isClosed
isFinal
missionDone

The concept does not belong in telemetry.

No telemetry completion fallback

Do not add:

if lifecycle missing done
and telemetry looks final
then completed

to BoardMetrics, CLI or cohorts.

Repair the lifecycle data instead.

No parallel integration completion API

Use MissionIntegrationService.

No premature Mission done

Mission may become done only after integration success is established.

No statistics calculations in UI

FLOW renders application-produced statistics.

No lifetime current-window regression

Old historical rows stay in DB but do not affect rolling-7-day decision metrics.

No unknown → zero compatibility

Especially for reviewFixRounds.

No elaborate repair tooling

No backup.

No generic reconciliation framework.

No interactive UI.

Keep the actual DB repair straightforward.

Acceptance Criteria

AC01 Mission lifecycle is the sole authority for mission completion.

AC02 Contemporary telemetry has no closed field.

AC03 Contemporary telemetry has no renamed equivalent completion boolean/marker.

AC04 closed is removed from current telemetry domain/types.

AC05 closed is removed from current telemetry writers.

AC06 closed is removed from current telemetry readers.

AC07 closed is removed from current SQLite measurement schema.

AC08 Generic telemetry helpers defining completion from closed=yes are removed.

AC09 Legacy CSV/import code may read old closed only inside an explicit legacy boundary.

AC10 Legacy telemetry closed cannot complete a contemporary Mission.

AC11 Normal approved/integration-ready Mission reaches done after successful integration.

AC12 Successful integration persists exactly one transition into done.

AC13 Lifecycle completion is not conditional on backlog task being review.

AC14 Mission is not marked done before actual integration success.

AC15 Failed integration creates no lifecycle completion.

AC16 Resume after landed-but-unclosed integration creates lifecycle completion exactly once.

AC17 Repeated integration remains idempotent.

AC18 Existing MissionIntegrationService is the authoritative integration-completion boundary.

AC19 Backlog promotion no longer owns Mission delivery completion.

AC20 Integration telemetry is recorded after lifecycle completion and contains no completion flag.

AC21 Telemetry write failure cannot undo an authoritative lifecycle completion.

AC22 Integration-time report reads lifecycle Mission flow.

AC23 Integration-time report and immediate standalone px stats observe the same completed Mission IDs.

AC24 Board/FLOW observes the same newly completed Mission immediately.

AC25 One successful deterministic integration changes current completed population N → N+1.

AC26 Failed integration leaves population N.

AC27 Retry/resume never changes N+1 → N+2.

AC28 Rolling current/previous 7-day semantics remain unchanged.

AC29 Historical lifetime rows cannot re-enter current lifecycle-cycle samples.

AC30 Unknown reviewFixRounds remains NULL/unavailable end-to-end.

AC31 Known reviewFixRounds zero remains distinct from unknown.

AC32 Unknown reviewFixRounds does not increase its metric observation count.

AC33 Lifecycle and new telemetry writes use the same canonical RepositoryId.

AC34 Worktree execution joins telemetry to the owning Mission repository.

AC35 Historical obvious missing lifecycle completions in the actual local DB are repaired.

AC36 Historical lifecycle repair does not create duplicate completion events.

AC37 Ambiguous historical completion cases are printed and skipped.

AC38 Historical reviewFixRounds fabricated zeros are replaced with authoritative value or NULL where straightforward.

AC39 Obvious legacy repository aliases are normalized where unambiguous.

AC40 Historical repair uses legacy closed only as supporting repair evidence.

AC41 Current measurement schema no longer contains telemetry closed after repair/migration.

AC42 Repair is idempotent.

AC43 Repair prints concise changed/skipped counts and skipped Mission IDs.

AC44 Actual local DB statistics are recorded before/after as task evidence.

AC45 No new completion heuristic is added to statistics readers.

AC46 No new parallel statistics or integration architecture is introduced.

AC47 Production certification starts no agent and invokes no LLM.

AC48 Production certification uses real persisted lifecycle + telemetry facts and real BoardMetrics/statistics reads.

AC49 Certification proves telemetry alone cannot complete a Mission.

AC50 git diff --check passes.

AC51 ./scripts/verify-local.sh all passes.

AC52 No focused or unannotated skipped tests are introduced.

Required checkpoints
Checkpoint 0 — baseline and forensic check

Capture:

BASELINE_SHA
working tree status

Inspect one recently integrated but uncounted Mission end-to-end.

Do not assume this task description is correct without checking current persisted evidence.

Checkpoint 1 — red tests

Create/reuse failing regressions for the live defects.

No broad fix first.

Checkpoint 2 — remove competing completion semantics

Remove telemetry closed from application/domain semantics and replace all contemporary completion selection with authoritative Mission lifecycle populations.

Keep only narrow legacy/repair parsing temporarily where necessary.

Checkpoint 3 — fix integration ordering

Move Mission completion to the actual successful integration boundary using MissionIntegrationService.

Cover:

normal
failure
resume
retry
Checkpoint 4 — unify stats read path

Make integration reporting, standalone stats and BoardMetrics consume the same completed Mission population.

Checkpoint 5 — reviewFixRounds

Remove all remaining unknown→zero coercion for this measurement and test real DB round trip.

Checkpoint 6 — DB repair

Repair actual local DB using the simplest reasonable implementation.

Use old telemetry closed only as repair evidence before removing the column.

No backup machinery.

Checkpoint 7 — remove legacy telemetry completion column

Complete current-schema migration/removal after repair information has been consumed.

Verify contemporary APIs cannot write/read it.

Checkpoint 8 — no-agent production certification

Prove:

successful integration = N+1 everywhere

failed integration = N everywhere

resume = N+1 exactly once

telemetry alone ≠ completion
Checkpoint 9 — operator verification

Run actual stats against repaired DB and capture current numbers.

Explain differences between mission flow and telemetry populations.

Checkpoint 10 — contradiction sweep

Search final tree for:

closed
closed === 'yes'
isCompletedStatisticsRow
summarizeCompletedMissionWindow
completedOnly
Mission complete
integration rollup
reviewFixRounds ?? 0
pr_fix_rounds ?? 0

For every remaining match, classify why it is valid.

Any contemporary telemetry completion semantics are a failure.

A remaining closed relating to unrelated concepts such as file handles, PR state, resources, etc. is obviously not part of this requirement.

Checkpoint 11 — verification

Run:

git diff --check
./scripts/verify-local.sh all
Definition of Done

Before marking the mission done, answer with evidence:

If I successfully integrate one approved Mission now, does current mission flow increase immediately by exactly one?
Does the integration-time report show the same completed Mission population as npm run dev -- stats immediately afterward?
Does px ui see that same completion?
Can telemetry represent Mission completion anymore?
Can a failed integration mark the Mission done?
Can retry/resume double-count completion?
Can unknown reviewFixRounds still become zero?
How many historical Mission completions were repaired in the actual DB?
Which historical Missions were skipped as ambiguous?
What are the actual current and previous rolling-7-day completion populations after repair?

Final evidence table:

Requirement	Result	Production evidence	Test/command evidence
Telemetry completion concept removed	PASS/FAIL	file	exact test/search
Successful integration → lifecycle done	PASS/FAIL	file	exact test
Failed integration stays incomplete	PASS/FAIL	file	exact test
Resume is idempotent	PASS/FAIL	file	exact test
Integration report = standalone stats	PASS/FAIL	file	exact test
Board population agrees	PASS/FAIL	file	exact test
reviewFixRounds nullability	PASS/FAIL	file	exact test
Historical DB repaired	PASS/FAIL	command/output	before/after
Current schema has no telemetry closed	PASS/FAIL	migration/schema evidence	exact test/query
Full verifier	PASS/FAIL	command	command result

Do not mark done while any row is FAIL.

Out of Scope
external analytics/BI;
statistical significance testing;
automatic experiment winner selection;
backup tooling for this DB repair;
generic DB reconciliation framework;
general integration-command refactor;
general stats.ts rewrite;
lifecycle-state redesign;
real-agent E2E;
LLM/network integration tests;
deletion of historical data simply because it is old.
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

---
id: TASK-2369
title: next round of stat fixes
status: backlog
assignee: [custom]
created_date: '2026-08-12 14:48'
labels: [user_value, bug]
dependencies: []
ordinal: 89912
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Problem

TASK-2367 fixed the main production symptom:

telemetry is no longer intended to own Mission completion;
successful already-approved integrations now have a post-landing lifecycle-completion path;
integration-time stats read lifecycle history;
the historical DB has been repaired sufficiently for current use.

However, post-mission review found remaining live correctness defects.

Defect 1 — two Mission-completion paths still exist

The correct path is conceptually:

integration lands
→ persistLandedIntegrationOrAbort
→ MissionIntegrationService.decideIntegration
→ integration → done

But the older backlog-promotion path can still invoke a Mission integrate lifecycle transition when the backlog task is in review.

That means Mission completion can still occur before the integration commit actually lands.

Depending on backlog task state, the same command therefore has two different completion semantics.

Defect 2 — resumed integration uses retry time as completion time

When integration already landed and px integrate resumes later, lifecycle completion can be timestamped with the retry time rather than the actual landed commit timestamp.

Since rolling-7-day statistics select missions by authoritative completion time, this can place a mission in the wrong decision window.

Defect 3 — unknown reviewFixRounds can still become measured zero

The persistence/domain model can represent unknown review-fix counts, but live convenience writers and compatibility conversions can still perform:

unknown → 0
NULL → "0"

This biases agent/experiment comparisons and inflates the observation count.

Defect 4 — previously removed footguns must not leak back through compatibility code

Contemporary telemetry must not regain Mission-completion semantics.

New telemetry writes must also continue using canonical repository identity.

Legacy/string-shaped compatibility code must not silently reintroduce:

telemetry closed/completed
product.name as new-write repository identity
unknown numeric measurement → measured zero

Fix these defects surgically.

Do NOT perform another statistics architecture cleanup.

Goal

There must be one and only one runtime path that can complete an integrated Mission:

actual landed integration commit
        ↓
MissionIntegrationService
        ↓
integration → done

And the lifecycle event must carry the actual landed integration timestamp.

Telemetry remains measurement-only.

Unknown review-fix evidence remains unknown.

After this mission:

same integration facts
→ same Mission lifecycle
→ same px stats population
→ same FLOW population

regardless of whether the backlog task entered integration from review or was already approved, and regardless of whether closeout occurred immediately or was resumed later.

Mandatory execution discipline
Guard 1 — pin and inspect baseline

Before changing code:

git rev-parse HEAD
git status --short

Record:

BASELINE_SHA=<sha>

Then trace the CURRENT production code.

Do not assume this task description perfectly matches the tree.

For each defect:

confirm current call path;
reproduce if still present;
if already fixed, record proof and do not churn the code.
Guard 2 — red tests before fixes

Before modifying the corresponding production seam, create or identify regressions for:

review backlog promotion followed by failed landing;
successful normal integration;
resumed already-landed integration with an old commit timestamp;
unknown reviewFixRounds through the real writer/read/report path.

The regression must fail for the expected reason before its production fix.

A helper-level test that bypasses the defective caller is insufficient.

Guard 3 — test the contradictory path, not only the desired service

Testing:

MissionIntegrationService.decideIntegration()

proves that service works.

It does NOT prove that:

px integrate

calls it at the right time.

At least one regression must exercise the integration CLI orchestration far enough to prove the ordering around:

review promotion
squash/commit landing
Mission completion

No real agent needs to run.

Guard 4 — exactly one completion owner

After this mission, the integration CLI must have exactly one semantic path capable of producing Mission done.

That path is the existing:

MissionIntegrationService.decideIntegration()

after integration has demonstrably landed.

Do not leave an alternate:

missionServices.lifecycle.transition({
  command: { type: 'integrate' }
})

inside backlog promotion or another CLI helper.

Do not introduce another completion helper/service.

Guard 5 — backlog promotion cannot complete a Mission

Backlog promotion may:

review → approved

for backlog/task representation.

It must NOT:

Mission → done

promoteTaskForIntegrationIfNeeded() or its successor must only perform the promotion necessary for the backlog representation.

A test must directly prove that invoking promotion cannot make the Mission done.

Guard 6 — landing timestamp, not observation/retry timestamp

The authoritative:

integration → done

event must use the timestamp of the actual landed integration commit.

Do not use:

new Date()
retry time
stats write time
worktree cleanup time

as delivery completion time when the landed commit timestamp is available.

This applies to:

normal integration;
resumed integration;
partial-closeout recovery.

Use one timestamp resolution path for both normal and resume.

Guard 7 — no telemetry completion fallback

Do not compensate for lifecycle bugs by making telemetry imply completion.

Forbidden:

measurement looks final
→ Mission completed

or:

legacy closed=yes
→ current Mission completion

Statistics readers remain lifecycle-authoritative.

Guard 8 — unknown reviewFixRounds is not zero

These states are distinct:

known zero      = 0
known non-zero  = N
unknown         = unavailable/null

No compatibility layer may collapse unknown into zero.

Guard 9 — no broad refactor

TASK-2369.x already owns structural splitting/cleanup of large CLI modules.

Do NOT use this mission to:

split integrate.ts;
split stats.ts;
move unrelated functions;
reorganize CLI architecture;
remove all legacy CSV support;
redesign telemetry;
rewrite BoardMetrics.

Make the smallest coherent correctness changes.

If a TASK-2369 extraction changes the seam while this mission runs, adapt to the extracted owner rather than duplicating it.

Part A — Remove premature Mission completion from backlog promotion
Required behavior

Given:

Mission status = review/integration-prep state
Backlog task = review
Review approval satisfied

calling the promotion portion may change:

Backlog:
review → approved

but MUST leave Mission delivery incomplete.

Only after actual integration lands may the Mission transition into done.

Required failure regression

Simulate:

review accepted
↓
promotion succeeds
↓
actual git commit/landing fails

Expected:

Mission.status != done

integration → done event count = 0

completed Mission population unchanged

This test must exercise the production integration orchestration or the exact extracted orchestration owner.

Do NOT replace it with:

MissionIntegrationService(merged=false)

because that bypasses the premature CLI path.

Implementation constraint

Delete the Mission lifecycle completion side effect from backlog promotion.

There should not be two completion paths with different preconditions.

Part B — Preserve the correct normal integration path

The existing post-landed path is the desired model.

Normal successful integration must remain:

land integration commit
↓
resolve actual landed commit + timestamp
↓
MissionIntegrationService.decideIntegration
↓
Mission integration → done
↓
administrative closeout
↓
telemetry/statistics

Required regression:

initial completed population = N

approved Mission successfully integrates

→ Mission = done
→ exactly one transition into done
→ completed population = N + 1

Running the same closeout again must remain:

N + 1

not:

N + 2
Part C — Correct resumed-integration completion timestamp
Required fixture

Use a deterministic landed commit:

commit landed:
2026-08-04T23:30:00+02:00

closeout/retry runs:
2026-08-06T10:00:00+02:00

Expected authoritative completion:

completedAt / integration→done occurredAt
=
2026-08-04T23:30:00+02:00

NOT August 6.

The mission must consequently belong to the decision window containing August 4.

Requirements

Use Git's actual landed commit metadata.

Resolve the timestamp from the specific landed commit, not simply:

git log -1

unless the code has already proven that HEAD is exactly the supplied landed commit.

Pass that timestamp explicitly to MissionIntegrationService.decideIntegration().

Do not rely on the service's new Date() fallback for integration closeout initiated by the CLI.

Administrative closedAt

Do not conflate:

delivery completedAt

with:

administrative closedAt

The critical statistic is the lifecycle transition into done.

If administrative closure intentionally uses closeout/retry time, document that distinction.

Do not move the delivery completion timestamp merely to match administrative closure.

Part D — Fix reviewFixRounds nullability through the LIVE path
Required semantics

Fixture:

Mission A
reviewFixRounds = known 0

Mission B
reviewFixRounds = known 2

Mission C
reviewFixRounds = unknown

Mission D
reviewFixRounds = unknown

Expected:

population = 4

reviewFixRounds observations:
[0, 2]

observationCount = 2

Unknown rows MUST NOT become:

[0, 2, 0, 0]
n = 4
Audit live writers

At minimum inspect and fix where necessary:

defaultPrFixRounds
recordActiveStats
recordReviewStats
recordStageStats
accumulateStageStats
recordIntegrationStats

If caller does not know the count and no known previous measurement exists:

return unknown

not:

return 0

If earlier mission telemetry contains a real known count, carrying that known value forward is allowed.

But ignore NULL/unavailable records when searching for a prior known maximum.

Examples:

previous [NULL, NULL]
→ unknown

previous [NULL, 0]
→ known 0

previous [NULL, 2]
→ known 2

Errors reading the measurement store must not silently manufacture zero.

Return unknown or fail according to existing telemetry-error semantics.

Part E — Fix the string-shaped read/write compatibility seam

Audit:

measurementToStatsRow
statsRowToMeasurement
normalizeStatsRow
canonicalizeStatsRow
USAGE_NUMBERS

The generic numeric default:

NULL → "0"

must NOT be applied to pr_fix_rounds.

If the existing StatsRow representation requires a string, use an unambiguous missing representation such as:

''

or make the field nullable if that is the smaller coherent change.

Whatever representation is chosen:

SQL NULL
→ StatsRow unknown
→ SQL NULL

must round-trip without becoming zero.

Known:

0

must round-trip as genuine zero.

Do not redesign every numeric metric in this mission.

Fix reviewFixRounds specifically unless evidence proves another metric has the same decision-critical bug.

Part F — Contemporary telemetry completion must remain absent

TASK-2367 removed telemetry completion as an authority.

Protect that invariant.

Audit contemporary statistics/measurement structures for fields or helpers equivalent to:

closed
completed
isFinal
isClosed
isCompletedStatisticsRow

No contemporary telemetry field may decide Mission completion.

If a legacy/string compatibility closed field still exists in current code:

prove it is strictly confined to explicit legacy import/read compatibility; or
remove it from contemporary StatsRow/report paths.

Do not leave a generic closed field attached to normal live measurement rows merely because old CSV code once expected it.

Do NOT create a renamed equivalent.

Legacy import code may parse historical data, but current statistics must not consume it as completion authority.

Part G — Protect canonical repository identity

New telemetry and Mission lifecycle records must use the same canonical owning RepositoryId.

Audit the live stats writer.

A configured:

product.name

may be used only as an explicit legacy read alias if still required.

It must NOT override canonical repository identity for newly written measurements.

Required regression:

checkout basename = actual-repo
product.name = different-display-name
worktree = actual-repo-task-2370

Expected new telemetry repository:

actual-repo

and it must join the authoritative Mission.

If this invariant is already correct at baseline, add/retain proof and do not rewrite it.

Part H — Preserve stats-surface agreement

TASK-2367 repaired the integration-time report so it reads lifecycle history.

Keep that behavior.

After a deterministic successful integration:

integration-time report
npm run dev -- stats
BoardMetrics/FLOW

must observe the same current completed Mission population.

This mission does not need another large dashboard fixture if existing coverage proves this.

But the integration regression must demonstrate that removing the premature completion path does not break the correct post-landed reporting path.

No-agent certification requirements

Tests MUST NOT:

start Codex;
start Claude;
start Pi;
invoke an LLM;
run a Parallix agent mission;
make network calls.

Use injected Git/process seams and real temporary persistence where useful.

The target is integration lifecycle/statistics orchestration, not agent behavior.

Mandatory regression set

At minimum add or strengthen these exact regressions.

R1 — review promotion cannot complete Mission
task status = review
approval satisfied
promotion succeeds
landing fails

Mission != done
done events = 0

Old premature behavior must fail this test.

R2 — approved normal integration completes once
task status = approved
landing succeeds

Mission = done
done events = 1

Retry remains one.

R3 — review normal integration completes only after landing

Instrument ordering.

Assert:

before landed commit exists:
Mission != done

after landed commit + authoritative closeout:
Mission = done

This guards against simply deleting one premature call and adding another elsewhere.

R4 — resumed integration uses landed timestamp
landed commit timestamp = T1
retry timestamp = T2

T1 != T2

completion event occurredAt = T1

Also assert window membership follows T1.

R5 — live reviewFixRounds known-zero vs unknown

Use:

recordActiveStats / recordReviewStats
→ real temporary SQLite
→ loadMeasurementRows / actual report aggregation

not merely a direct repository insert.

Assert:

known 0 remains 0
unknown remains unknown
R6 — reviewFixRounds report n excludes unknown

Fixture:

[0, 2, unknown, unknown]

Report/cohort observation count:

n = 2
R7 — telemetry cannot complete Mission

A telemetry measurement with whatever legacy-final-looking fields remain must not change lifecycle completion population.

R8 — canonical repo identity

If not already strongly covered:

worktree + product.name mismatch
→ new telemetry still joins canonical Mission repo
Mutation sensitivity

For R1, R4 and R5, explain explicitly why the test would fail under the old implementation.

Where practical, temporarily reintroduce locally:

promotion → mission lifecycle integrate

and prove R1 turns red.

Temporarily use:

new Date()

instead of landed commit timestamp and prove R4 turns red.

Temporarily restore:

unknown → 0

and prove R5/R6 turn red.

Restore correct code immediately.

Do not commit mutations.

Contradiction sweep

Before final verification search the final tree for:

command: { type: 'integrate' }
promoteTaskForIntegrationIfNeeded
decideIntegration
new Date().toISOString()
pr_fix_rounds ?? 0
reviewFixRounds ?? 0
defaultPrFixRounds
measurementToStatsRow
closed
isCompletedStatisticsRow
product.name
resolveStatsRepoName

Classify every relevant match.

Required outcome:

Integration completion

There is one production semantic owner:

landed integration
→ MissionIntegrationService.decideIntegration
reviewFixRounds

Unknown is never converted to zero.

completion authority

Telemetry has no contemporary Mission-completion authority.

repository identity

New writes use canonical owning repository identity.

Do not bulk-replace search results.

Slop guards
Do not fix the test instead of the code

Do not change a test fixture from:

taskStatus = review

to:

taskStatus = approved

to bypass the premature path.

Both must be tested.

Do not satisfy R1 by mocking away promotion

The production promotion logic must execute.

Do not satisfy R4 by injecting the expected timestamp directly into the service test

The integration orchestration must resolve the timestamp from the landed commit and pass it onward.

Do not satisfy reviewFixRounds only at repository level

A direct:

insert NULL
→ read NULL

test is insufficient.

The live convenience writer and compatibility mapping must be exercised.

Do not preserve "compatibility" that changes semantics

CSV/string-shaped compatibility must not turn:

unknown

into:

0
Do not create another integration coordinator

Use the existing integration service.

Do not broaden this into TASK-2369 cleanup

Correctness only.

Acceptance Criteria

AC01 Baseline SHA and working-tree state are recorded.

AC02 The review promotion + failed landing bug is reproduced at baseline if still present.

AC03 Backlog promotion cannot transition Mission into done.

AC04 promoteTaskForIntegrationIfNeeded or its successor owns only backlog/task promotion semantics.

AC05 There is exactly one production Mission integration-completion path.

AC06 That path goes through MissionIntegrationService.decideIntegration.

AC07 Mission completion occurs only after the actual integration commit exists.

AC08 A failed integration cannot leave Mission done.

AC09 Normal approved integration produces exactly one transition into done.

AC10 Normal review-origin integration produces exactly one transition into done, after landing.

AC11 Retry does not create a duplicate completion event.

AC12 Resume after an already-landed integration reconciles completion exactly once.

AC13 integration → done event timestamp comes from the actual landed commit.

AC14 Resume time cannot move a Mission into a different statistics window.

AC15 The landed timestamp is resolved from the specific landed commit.

AC16 Delivery completion timestamp remains distinct from administrative closeout time where those semantics differ.

AC17 Unknown reviewFixRounds remains unknown through recordActiveStats.

AC18 Unknown reviewFixRounds remains unknown through recordReviewStats.

AC19 Known reviewFixRounds = 0 remains a real observed zero.

AC20 Known prior fix-round measurements may be carried forward without treating NULL as zero.

AC21 Measurement-store read failure does not manufacture reviewFixRounds zero.

AC22 SQL NULL survives measurement → StatsRow conversion as unknown.

AC23 Unknown StatsRow reviewFixRounds converts back to SQL NULL.

AC24 [0,2,unknown,unknown] aggregates from exactly two observations.

AC25 Agent-performance/cohort reporting uses the correct reviewFixRounds observation count.

AC26 Contemporary telemetry cannot define Mission completion.

AC27 Any remaining legacy closed compatibility is explicitly quarantined from live measurement semantics.

AC28 No renamed telemetry completion flag is introduced.

AC29 New telemetry writes use canonical owning RepositoryId.

AC30 Different product.name cannot split new telemetry from Mission lifecycle identity.

AC31 Integration-time stats continue reading lifecycle Mission flow.

AC32 Integration-time report, standalone px stats, and BoardMetrics agree on newly completed Mission population.

AC33 Rolling current/previous 7-day semantics are unchanged.

AC34 No historical/lifetime population re-enters current decision metrics.

AC35 No parallel integration/statistics architecture is introduced.

AC36 TASK-2369 structural cleanup scope is not pulled into this mission.

AC37 Critical regressions exercise the defective callers rather than only helper/application services.

AC38 R1/R4/R5 have documented old-bug sensitivity.

AC39 No agent, LLM, mission runner, or network is used by certification tests.

AC40 git diff --check passes.

AC41 ./scripts/verify-local.sh all passes.

AC42 No focused or unannotated skipped tests are introduced.
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

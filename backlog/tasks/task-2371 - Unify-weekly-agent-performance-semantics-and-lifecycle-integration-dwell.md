---
id: TASK-2371
title: Unify weekly agent-performance semantics and lifecycle integration dwell
status: backlog
assignee: [codex]
created_date: '2026-08-13 14:58'
labels: [ai_sdlc]
dependencies: []
ordinal: 91912
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The core statistics architecture is now substantially correct:

* Mission lifecycle is authoritative for completion;
* telemetry cannot complete a Mission;
* successful integration reaches `done` only after the landed commit;
* resumed integration uses the landed commit timestamp;
* FLOW uses rolling current/previous seven-day completed-Mission cohorts;
* new telemetry uses canonical repository identity;
* telemetry writers can represent unknown `reviewFixRounds`.

Three remaining defects still make lifecycle and CLI statistics misleading.

### Defect A — review-origin integration skips the `integration` lifecycle state

When an integration starts while the authoritative Mission is still in `review`, the Backlog representation can be promoted to approved without performing the corresponding authoritative Mission lifecycle transition:

```text
review → integration
```

The subsequently landed integration can therefore produce:

```text
review → done
```

instead of:

```text
review → integration → done
```

This biases lifecycle statistics:

```text
review dwell      too high
integration dwell too low / zero
```

### Defect B — CLI Agent Performance uses telemetry dates instead of the completed-Mission cohort

FLOW answers:

> How did Missions completed during this rolling seven-day window perform?

The CLI `Agent performance this week` can instead effectively answer:

> Which telemetry rows happened during these seven days for Missions that eventually completed?

Those populations differ.

Example:

```text
Mission A
agent work:  Aug 4
completed:   Aug 10
```

For the current window containing Aug 10:

```text
FLOW:
include Mission A and its full telemetry

CLI Agent Performance:
can discard the Aug 4 telemetry first
```

The inverse also occurs:

```text
Mission B
completed:        Aug 4
closeout telemetry: Aug 7
```

Mission B belongs to the previous completed-Mission cohort but its Aug 7 telemetry can appear in the current CLI performance window.

### Defect C — CLI average PR fix rounds still treats unknown as zero

The live writers can now preserve unknown review-fix evidence.

But the Agent Performance aggregation can still perform the equivalent of:

```text
missing reviewFixRounds → 0
```

and divide by all implementer Missions.

For:

```text
Mission A = known 0
Mission B = known 2
Mission C = unknown
Mission D = unknown
```

correct:

```text
PR fix values = [0, 2]
PR fix n      = 2
average       = 1.00
```

incorrect:

```text
[0, 2, 0, 0]
n = 4
average = 0.50
```

There is also a fallback task-text parser that can interpret absence of recognizable review evidence as a known zero.

Fix these three defects without another statistics redesign.

---

# Goal

After this mission there is one coherent definition of a weekly **Mission performance cohort**:

```text
authoritative Mission completedAt
            │
            ▼
current / previous rolling 7-day cohort
            │
            ├── lifecycle cycle/dwell/bounce
            ├── implementer attribution
            ├── complete telemetry for those Missions
            └── reviewFixRounds where actually observed
```

CLI Agent Performance and FLOW must use the same Mission cohort semantics.

Telemetry timestamps may still define a separate **resource-consumption** view such as:

```text
Agent spend incurred during the last 7 days
```

but must not determine which Missions belong to Agent Performance.

---

# Mandatory execution rules

## Guard 1 — pin baseline

Before changing code:

```bash
git rev-parse HEAD
git status --short
```

Record:

```text
BASELINE_SHA=<sha>
```

Trace the current production implementations before assuming this mission text is still exact.

If a defect has already been fixed:

* prove it with source + regression evidence;
* do not manufacture code churn.

---

## Guard 2 — regressions before fixes

Before modifying each production seam, reproduce:

1. review-origin Mission skips `integration`;
2. telemetry-date and completion-date windows disagree;
3. unknown reviewFixRounds lowers CLI average.

Tests must use deliberately adversarial data.

Do not write fixtures where telemetry date and Mission completion date happen to be the same.

---

## Guard 3 — no architecture wave

Do not introduce:

* StatisticsV2;
* AgentPerformanceV2;
* another MissionOutcome type;
* another cohort engine;
* another window service;
* another lifecycle state machine;
* another telemetry repository.

Reuse the existing:

* Mission lifecycle;
* decision-window service;
* lifecycle completed population;
* MissionOutcome/cohort projection;
* canonical repository identity.

TASK-2369 owns structural extraction/CLI splitting.

Do not absorb its work.

---

# Part A — authoritative review → integration transition

## Required lifecycle

Once review approval has been established, the authoritative Mission must enter:

```text
integration
```

before actual integration landing is attempted.

The lifecycle must therefore be:

```text
review
  ↓ approve
integration
  ↓ landed integration
done
```

not:

```text
review
  ↓ landed integration
done
```

## Important distinction

This does NOT mean restoring the old premature:

```text
integrate → done
```

call before Git landing.

The pre-landing transition is:

```text
approve:
review → integration
```

The post-landing transition remains:

```text
integrate:
integration → done
```

## Required behavior

When:

```text
Mission.status = review
Backlog task = review
review approval is fulfilled
```

promotion must leave:

```text
Backlog representation = approved / integration-ready
Mission.status = integration
```

before landing.

If Git landing later fails:

```text
Mission.status = integration
```

is valid.

It must NOT revert to review automatically and must NOT become done.

The Mission is waiting for integration/retry.

## Already-integrating Mission

If:

```text
Mission.status = integration
```

promotion/approval must be idempotent.

Do not create duplicate:

```text
review → integration
```

events.

---

# Part B — lifecycle dwell must follow the real states

Add a deterministic lifecycle test with timestamps:

```text
10:00 review entered
10:30 review approved
10:30 integration entered
11:15 landed
11:15 done entered
```

Expected:

```text
review dwell      = 30 min
integration dwell = 45 min
```

The test must fail if the implementation produces:

```text
review → done
```

because that would yield:

```text
review dwell      = 75 min
integration dwell = unavailable/0 observations
```

Test the resulting statistics, not just Mission status.

This is the business reason for fixing the lifecycle path.

---

# Part C — define Agent Performance by Mission completion window

CLI:

```text
Agent performance this week
```

must mean:

> Agent performance for Missions whose authoritative lifecycle completion falls in the current rolling seven-day decision window.

Previous week means the immediately preceding rolling seven-day Mission-completion cohort.

Use the exact same current/previous decision-window semantics as FLOW and default `px stats`.

## Correct algorithm

```text
all authoritative completed Missions
          ↓
select current/previous by completedAt
          ↓
join ALL telemetry belonging to selected Missions
          ↓
derive implementer/performance metrics
```

## Forbidden algorithm

```text
telemetry rows
     ↓
filter rows by telemetry date
     ↓
check whether Mission completed sometime
     ↓
compute Agent Performance
```

Telemetry row date does not decide Agent Performance cohort membership.

---

# Part D — full telemetry belongs to the selected Mission

A Mission selected by `completedAt` contributes its relevant complete telemetry even when individual runs occurred before the selected seven-day window.

Example:

```text
current window:
Aug 6 → Aug 12

Mission A
draft:     Aug 2
execute:   Aug 4
review:    Aug 8
completed: Aug 10
```

Agent Performance for the current window must be able to use:

```text
draft
execute
review
```

from Mission A as appropriate for the metric.

Do not truncate Mission evidence at Aug 6.

This matches FLOW/MissionOutcome semantics.

---

# Part E — keep Agent Spend semantically separate

`Agent spend by stage this week` may legitimately answer a different question:

> What resources were consumed during this seven-day period?

If that is the existing intended semantic, it may continue filtering telemetry by telemetry date.

Do not force spend to use Mission-completion cohort merely to make every table identical.

Instead make the distinction explicit.

Recommended labels:

```text
Agent performance — missions completed this week
```

and:

```text
Agent spend incurred this week
```

Exact wording may vary.

The important requirement is that an operator can tell why the populations differ.

Add a short code-level semantic comment/contract at the application/report boundary.

---

# Part F — use lifecycle-completed Mission keys for the correct window

Do not pass one undifferentiated:

```text
allCompletedMissionKeys
```

into current/previous Agent Performance and then filter telemetry by row date.

Expose/use:

```text
currentCompletedMissionKeys
previousCompletedMissionKeys
```

or equivalent application-owned populations derived from authoritative `completedAt`.

Prefer returning these from the same Mission-flow/window computation already used by the report rather than rebuilding completion semantics in `stats.ts`.

No duplicate lifecycle database scan unless current architecture genuinely requires it.

---

# Part G — correct implementer Mission counts

For Agent Performance:

```text
# missions as implementer
```

means Missions in that completed-Mission decision cohort attributed to that implementer/agent family.

Each Mission counts once per applicable grouping semantics.

It must not mean:

```text
# missions having telemetry rows dated this week
```

Test with telemetry spanning several weeks.

---

# Part H — unknown reviewFixRounds must be excluded from the average

For every agent-family summary maintain two different counts:

```text
missions as implementer
```

and:

```text
missions with reviewFixRounds evidence
```

Example:

```text
gpt-x

missions as implementer = 6
reviewFixRounds known   = 4

values:
0, 1, 2, 1

average = 1.00
PR-fix n = 4
```

Do not divide by 6.

## Presentation

The CLI table must expose the evidence count when it differs from the implementer Mission count.

For example:

```text
Agent family  Missions  PR fix n  Avg PR fix rounds
gpt-x         6         4         1.00
```

If there are zero known review-fix observations:

```text
Avg PR fix rounds = —
PR fix n = 0
```

Do not display:

```text
0.00
```

because that falsely means known zero fixes.

---

# Part I — remove aggregation-time unknown → zero

Audit the live Agent Performance calculations, especially equivalents of:

```text
storedRoundsByMission[key] || 0
```

or:

```text
value ?? 0
```

when building the average.

Required semantics:

```text
undefined/null → no observation
0              → observed zero
N              → observed N
```

Keep `0` when genuinely observed.

Exclude unknown from:

```text
sum
denominator
observationCount
```

---

# Part J — fix task-text reviewFixRounds fallback

Audit:

```text
deriveFixRoundsFromTaskText
```

or its extracted successor.

Absence of recognizable evidence is not evidence of zero rounds.

Required return semantics:

```text
unknown / no evidence  → null/undefined
explicit evidence 0    → 0
explicit evidence N    → N
```

If task file is absent:

```text
unknown
```

If task exists but contains no trustworthy review-round evidence:

```text
unknown
```

Do not infer zero from silence.

If the current Review aggregate already provides an authoritative value, prefer it.

The task-text parser remains fallback-only.

---

# Part K — keep review bounce separate

Do not confuse:

```text
reviewFixRounds
```

with:

```text
review → active lifecycle bounce rate
```

They remain different metrics.

FLOW's lifecycle bounce calculation must not be changed to match telemetry fix-round values.

CLI Agent Performance may report PR fix rounds as telemetry/evidence, but not label them as bounce rate.

---

# Adversarial certification fixture

Create one deterministic fixture explicitly designed to make the old implementation wrong.

Use:

```text
current window:
Aug 6 → Aug 12

previous window:
Jul 30 → Aug 5
```

## Mission A

```text
implementer: terra
execute telemetry: Aug 4
review telemetry:  Aug 5
completedAt:       Aug 10
reviewFixRounds:   2
```

Expected:

```text
Agent Performance CURRENT
includes A

Agent Performance PREVIOUS
does not include A
```

Even though most telemetry happened in the previous window.

## Mission B

```text
implementer: terra
execute telemetry: Aug 2
completedAt:       Aug 4
late closeout measurement: Aug 8
reviewFixRounds:   0
```

Expected:

```text
Agent Performance PREVIOUS
includes B

Agent Performance CURRENT
does not include B
```

The Aug 8 telemetry must not move B into current Agent Performance.

## Mission C

```text
implementer: terra
completedAt: Aug 11
reviewFixRounds: unknown
```

## Mission D

```text
implementer: terra
completedAt: Aug 11
reviewFixRounds: unknown
```

For current Agent Performance:

```text
missions as implementer:
A, C, D = 3

known PR fix values:
A = 2

PR fix n = 1
average = 2.00
```

Unknown C/D must not lower that average.

## Mission E

```text
review enters:      Aug 10 10:00
approve/integration: Aug 10 10:30
landed/done:         Aug 10 11:15
```

Expected:

```text
review dwell      = 30m
integration dwell = 45m
```

---

# Required regression tests

## R1 — review approval enters integration

Exercise the production lifecycle/orchestration seam.

Assert:

```text
review approval
→ Mission.status = integration
→ one review → integration event
```

Do not merely assert Backlog-file movement.

## R2 — failed landing after approval

Assert:

```text
review → integration
landing fails
Mission remains integration
done events = 0
```

This protects against the old premature completion bug while preserving correct lifecycle state.

## R3 — successful review-origin integration

Assert:

```text
review
→ integration
→ done
```

with exactly those lifecycle transitions.

No direct:

```text
review → done
```

event is permitted.

## R4 — dwell statistics

Assert exact:

```text
review = 30
integration = 45
```

from persisted lifecycle facts.

## R5 — telemetry-before-completion-window

Mission A must belong to current Agent Performance despite its execution telemetry predating the current window.

## R6 — telemetry-after-completion-window

Mission B must remain previous Agent Performance despite a later telemetry row falling in the current window.

## R7 — unknown fix rounds

Fixture:

```text
[2, unknown, unknown]
```

must produce:

```text
average = 2.00
PR fix n = 1
```

not:

```text
0.67
n = 3
```

## R8 — known zero

Fixture:

```text
[0, 2, unknown, unknown]
```

must produce:

```text
average = 1.00
PR fix n = 2
```

Known zero must not be dropped by truthiness logic.

## R9 — task-text no evidence

No review-round evidence must produce:

```text
unknown
```

not:

```text
0
```

## R10 — spend semantics remain intentional

If Agent Spend remains telemetry-date-windowed, prove Mission B's Aug 8 consumption can appear in current spend while Mission B remains in previous Agent Performance.

This deliberately demonstrates that the two tables answer different questions.

---

# Test quality guards

## Do not align dates accidentally

At least R5/R6 must use different:

```text
telemetry date
completedAt
```

windows.

A fixture where both happen in the same week is insufficient.

## Do not manually inject the desired current/previous grouping into the function under test

Seed authoritative lifecycle completion timestamps and let the production application logic derive membership.

## Do not test only `compareCohorts`

The defect is primarily in CLI Agent Performance.

The CLI/application report path must be exercised.

## Do not test only a PR-fix helper

The final aggregate/report must be asserted.

## Exact assertions

Do not use only:

```text
contains terra
non-empty
value is numeric
```

Assert exact:

```text
Mission IDs
Mission counts
PR-fix n
average
window assignment
```

---

# Old-bug sensitivity requirement

For each critical regression document why the prior implementation fails.

At minimum:

### R5

Old telemetry-date-first filtering excludes Mission A from current performance.

### R6

Old telemetry-date-first filtering admits Mission B into current performance.

### R7/R8

Old:

```text
unknown || 0
```

changes the denominator/average.

### R1/R4

Old review→done lifecycle produces no integration dwell and too much review dwell.

Where practical, temporarily restore the former behavior and show the targeted test turns red.

Do not commit the mutation.

---

# One semantic owner

After the fix, avoid separate definitions like:

```text
FLOW completed cohort
CLI Agent Performance cohort
cohort command completed cohort
```

that each independently perform date filtering.

Use the existing application-owned:

```text
decision window
+
authoritative lifecycle completedAt
```

semantics.

If a small shared function must be extracted from CLI code, it must replace duplicated population selection in the same mission.

Do not create a generic analytics framework.

---

# Contradiction sweep

Before closing, search relevant code for:

```text
row.date >=
row.date <=
completedMissionKeys
currentCompleted
previousCompleted
summarizeAgentWindow
computeAgentMissionGroups
storedRoundsByMission
|| 0
?? 0
deriveFixRoundsFromTaskText
review → done
command: { type: 'approve' }
command: { type: 'integrate' }
```

Classify each relevant result.

Required outcome:

### Lifecycle

```text
review → integration
integration → done
```

for approved review-origin integrations.

### Agent Performance

Mission cohort membership derives from lifecycle `completedAt`.

### Agent Spend

Telemetry-date semantics remain only where intentionally measuring resource consumption.

### PR fix rounds

Unknown never enters the aggregate as zero.

---

# Acceptance Criteria

* [ ] AC01 Baseline SHA and working-tree state are recorded.
* [ ] AC02 Review-origin integration currently skipping the authoritative integration state is reproduced if still present.
* [ ] AC03 Approved review causes authoritative Mission `review → integration`.
* [ ] AC04 Backlog approval and Mission approval remain aligned.
* [ ] AC05 Approval does not mark Mission done.
* [ ] AC06 Failed landing after approval leaves Mission in integration, not done.
* [ ] AC07 Successful review-origin integration produces `review → integration → done`.
* [ ] AC08 No successful review-origin integration produces direct `review → done`.
* [ ] AC09 Review dwell ends at approval/integration entry.
* [ ] AC10 Integration dwell begins at approval and ends at landed completion.
* [ ] AC11 Exact dwell regression proves review=30m and integration=45m for the certification fixture.
* [ ] AC12 CLI Agent Performance current population is selected by lifecycle `completedAt`.
* [ ] AC13 CLI Agent Performance previous population is selected by lifecycle `completedAt`.
* [ ] AC14 Telemetry dates cannot move a Mission between Agent Performance windows.
* [ ] AC15 Full relevant telemetry for a selected completed Mission is available to Agent Performance even when rows predate the window.
* [ ] AC16 A late telemetry row cannot move a previously completed Mission into current Agent Performance.
* [ ] AC17 FLOW and CLI Agent Performance use the same current/previous completed-Mission populations where they describe the same performance cohort.
* [ ] AC18 `# missions as implementer` counts Missions in the completed-Mission cohort.
* [ ] AC19 PR-fix average uses only Missions with known reviewFixRounds evidence.
* [ ] AC20 PR-fix observation count is separate from implementer Mission count.
* [ ] AC21 Known `reviewFixRounds=0` contributes as an observed zero.
* [ ] AC22 Unknown reviewFixRounds contributes neither zero nor denominator.
* [ ] AC23 `[0,2,unknown,unknown]` produces average 1.00 with PR-fix n=2.
* [ ] AC24 Zero known PR-fix observations render unavailable/— rather than 0.00.
* [ ] AC25 Task-text absence/no recognizable evidence yields unknown, not zero.
* [ ] AC26 Review aggregate remains preferred over task-text fallback when available.
* [ ] AC27 Review bounce and reviewFixRounds remain separate metrics.
* [ ] AC28 Agent Spend semantics are explicitly distinguished from completed-Mission Agent Performance.
* [ ] AC29 If spend remains telemetry-date-windowed, tests intentionally prove this different semantic.
* [ ] AC30 Existing rolling current/previous seven-day decision-window definition is reused.
* [ ] AC31 No new statistics/cohort/window architecture is introduced.
* [ ] AC32 TASK-2369 structural cleanup is not absorbed into this mission.
* [ ] AC33 R5/R6 use telemetry dates and completion dates in opposing windows.
* [ ] AC34 R7/R8 assert exact PR-fix averages and evidence counts.
* [ ] AC35 Critical tests document why the old implementation fails.
* [ ] AC36 No agent, LLM, mission runner, or network is required by the tests.
* [ ] AC37 Canonical repository identity and lifecycle completion authority remain unchanged.
* [ ] AC38 Telemetry does not regain Mission completion semantics.
* [ ] AC39 `git diff --check` passes.
* [ ] AC40 `./scripts/verify-local.sh all` passes.
* [ ] AC41 No focused or unannotated skipped tests are introduced.

---

# Required checkpoints

## Checkpoint 0 — baseline

Capture:

```text
BASELINE_SHA
git status
```

Trace current:

```text
review approval
Mission transition
Agent Performance grouping
weekly population selection
PR-fix aggregation
task-text fallback
```

## Checkpoint 1 — red lifecycle tests

Add R1–R4.

Do not modify production lifecycle first.

## Checkpoint 2 — lifecycle alignment

Persist authoritative:

```text
review → integration
```

at approval while retaining post-landed:

```text
integration → done
```

Run R1–R4.

## Checkpoint 3 — red Agent Performance window tests

Add R5/R6 with deliberately opposing telemetry/completion dates.

Capture incorrect baseline Mission populations.

## Checkpoint 4 — unify performance cohort

Make Agent Performance consume current/previous lifecycle-completed Mission populations and their full telemetry.

Do not change Agent Spend accidentally.

## Checkpoint 5 — red PR-fix evidence tests

Add R7–R9 through the final aggregation/report path.

## Checkpoint 6 — fix PR-fix evidence semantics

Remove aggregate-time unknown→zero and no-evidence→zero fallbacks.

Expose PR-fix n.

## Checkpoint 7 — semantic separation

Verify labels/contracts clearly distinguish:

```text
performance of Missions completed in window
```

from:

```text
telemetry spend incurred in window
```

## Checkpoint 8 — integrated certification

Run the adversarial fixture end-to-end through the relevant application/CLI statistics path.

Assert exact cohort memberships and metrics.

## Checkpoint 9 — contradiction sweep

Search/classify the patterns listed above.

## Checkpoint 10 — verification

Run:

```bash
git diff --check
./scripts/verify-local.sh all
```

---

# Definition of Done

Before marking done, answer with test evidence:

1. Does every review-origin successful integration now record `review → integration → done`?
2. Can a failed landing after approval ever produce Mission `done`?
3. Does the lifecycle fixture report exactly 30m review dwell and 45m integration dwell?
4. Does a Mission completed this week remain in this week's Agent Performance when its execution telemetry occurred last week?
5. Does a Mission completed last week remain out of this week's Agent Performance when a late telemetry row occurs this week?
6. Does `[0,2,unknown,unknown]` report PR-fix average 1.00 with `n=2`?
7. Does an implementer with no known PR-fix observations display unavailable rather than 0.00?
8. Are Agent Performance and Agent Spend now explicitly different only where their underlying questions genuinely differ?
9. Do FLOW and CLI use the same lifecycle completed-Mission cohort for comparable performance metrics?

Final evidence table:

| Requirement                       | Result    | Production evidence | Regression evidence | Old-bug sensitivity |
| --------------------------------- | --------- | ------------------- | ------------------- | ------------------- |
| review → integration → done       | PASS/FAIL | file:line           | test                | explanation         |
| failed landing stays integration  | PASS/FAIL | file:line           | test                | explanation         |
| lifecycle dwell correct           | PASS/FAIL | file:line           | test                | explanation         |
| Agent Performance current cohort  | PASS/FAIL | file:line           | test                | explanation         |
| Agent Performance previous cohort | PASS/FAIL | file:line           | test                | explanation         |
| full Mission telemetry used       | PASS/FAIL | file:line           | test                | explanation         |
| PR-fix unknown excluded           | PASS/FAIL | file:line           | test                | explanation         |
| PR-fix n exposed                  | PASS/FAIL | file:line           | test                | explanation         |
| spend/performance distinction     | PASS/FAIL | file:line           | test                | explanation         |
| full verifier                     | PASS/FAIL | command             | command             | —                   |

Do not mark the mission done while any row is FAIL.

---

# Out of Scope

* historical DB repair;
* telemetry `closed` migration work already completed;
* repository identity redesign;
* new metrics;
* dashboard redesign;
* statistical significance;
* TASK-2369 module splitting;
* generic stats architecture cleanup;
* real-agent E2E;
* network-backed tests;
* lifecycle state redesign beyond ensuring the existing `integration` state is actually represented.
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

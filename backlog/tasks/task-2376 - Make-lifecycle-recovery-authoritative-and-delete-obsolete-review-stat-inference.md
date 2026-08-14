---
id: TASK-2376
title: >-
  Make lifecycle recovery authoritative and delete obsolete review-stat
  inference
status: active
assignee: [claude]
created_date: '2026-08-14 05:35'
labels: [user_value, bug]
dependencies: []
ordinal: 96912
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
references:
  - TASK-2371
  - TASK-2372
  - src/domain/mission-workflow.ts
  - src/domain/review.ts
  - src/adapters/review/review-commands.ts
  - src/adapters/cli/commands/integrate.ts
  - src/adapters/cli/commands/stats.ts
  - src/application/mission-lifecycle-service.ts
  - src/application/mission-integration-service.ts
  - test/
---
```

## Problem

Recent missions fixed the major statistics defects:

* lifecycle is authoritative for completion;
* telemetry cannot complete a Mission;
* integration completion happens after the landed commit;
* resumed integration uses the landed commit timestamp;
* Agent Performance uses lifecycle-completed Mission cohorts;
* unknown reviewFixRounds is excluded from averages.

Two correctness problems remain.

### 1. Review approval and Mission lifecycle can still diverge

The authoritative Review contains the real approval timestamp:

```text
ReviewerDecision {
  kind: approved
  decidedAt: T
}
```

but the Mission can remain:

```text
status = review
```

until `px integrate` runs later.

`px integrate` then reconciles:

```text
review → integration
```

using integration-command time rather than the original review decision time.

Example:

```text
10:00  Mission enters review
10:30  Review approved
14:00  px integrate starts
14:15  integration lands
```

Current lifecycle can therefore imply:

```text
review dwell      = 4h
integration dwell = 15m
```

instead of:

```text
review dwell      = 30m
integration dwell = 3h45m
```

This makes lifecycle bottleneck statistics wrong.

### 2. Statistics still contain obsolete inference paths

When authoritative Review information is unavailable, current statistics code can still attempt to reconstruct implementer/fix-round information from weaker representations such as:

```text
PR comments
Git/branch history
review-state commit history
Backlog task text
```

These paths are not required to read historical statistics already persisted in SQLite.

There are no relevant pre-cutover Missions that need to continue executing through these paths.

Worse, a current caller can fall into this "legacy" behavior simply because it failed to provide the MissionStore.

This creates competing truth sources and has repeatedly produced fabricated zeros and agent slop.

Delete these obsolete inference paths.

---

# Architectural invariants

## One workflow

The authoritative lifecycle is:

```text
active
  ↓ submit-for-review
review
  ↓ approve
integration
  ↓ landed integration
done
```

Each arrow has exactly one existing domain/application meaning.

`px integrate` may orchestrate/recover missing transitions.

It MUST NOT invent shortcuts.

## One review authority

Current review metadata comes from:

```text
Mission Review aggregate
```

not:

```text
PR prose
Git history
Backlog text
telemetry inference
```

## One completion authority

Mission completion remains:

```text
integration → done
```

after landed integration.

No `active → done`.

No `review → done`.

---

# Part A — Move review → integration to the real approval boundary

When an authoritative Review decision becomes:

```text
kind = approved
decidedAt = T
```

the normal workflow must persist:

```text
Mission:
review → integration

occurredAt = T
```

at that approval boundary.

Do not normally wait for `px integrate`.

## Ordering

The normal approval transaction/orchestration should be:

```text
authoritative Review approval established
↓
Mission review → integration @ ReviewerDecision.decidedAt
↓
Backlog representation promoted to approved/integration-ready
```

The Backlog representation must not become the source of lifecycle truth.

If lifecycle persistence fails, do not silently leave an apparently approved Backlog item while Mission remains stale.

Use the existing Mission lifecycle application service.

Do not mutate Mission SQL directly.

---

# Part B — cover every authoritative approval path

Audit all currently supported ways a Review can become authoritatively approved, including where applicable:

```text
provider-backed review
provider=none/local review
human/manual review override
self/local approval
automated/artifact review producing a real ReviewerDecision
```

Every genuine approval path must converge on:

```text
ReviewerDecision(kind=approved, decidedAt=T)
→ Mission approve transition @ T
```

Do not fix only one CLI branch.

Prefer one small shared orchestration operation over copying the transition into several adapters.

Do not introduce a second Review or lifecycle subsystem.

---

# Part C — px integrate remains a recovery/orchestration command

`px integrate` MUST continue to work when bugs or interrupted workflows leave an otherwise integratable Mission in a stale state.

Supported recovery starting states:

```text
active
review
integration
done/resume
```

where sufficient authoritative evidence exists.

But `px integrate` must recover by invoking the existing workflow transitions in sequence.

It must never skip directly to `done`.

## Recovery matrix

### Mission = active

`px integrate` may recover:

```text
active → review → integration
```

but only through the existing authoritative operations.

If valid Review/handoff facts already exist:

```text
invoke/reconcile existing submit-for-review transition
```

If Review facts do not exist but an explicit human review override is being used:

```text
invoke the existing authoritative human-review path
→ persist a real Review / ReviewerDecision
→ continue normal lifecycle
```

If neither authoritative Review evidence nor a supported override can be established:

```text
STOP with actionable error
```

Do not infer Review from Git/PR/task text.

### Mission = review

If current Review is already approved:

```text
invoke existing approve transition
occurredAt = ReviewerDecision.decidedAt
```

If an explicit human override is supplied:

```text
record it through the existing authoritative Review mechanism
→ obtain ReviewerDecision(kind=approved)
→ invoke approve
```

If Review is not approved and no valid override exists:

```text
STOP
```

### Mission = integration

Proceed with integration normally.

Do not create another approval event.

### Mission = done

Use existing resume/idempotent closeout behavior only.

Do not create duplicate lifecycle events or completion counts.

---

# Part D — recovery must reuse existing transition logic

Forbidden recovery implementation:

```text
if active:
    mission.status = review

if review:
    mission.status = integration
```

or new helpers duplicating domain rules.

Instead invoke existing workflow/application operations equivalent to:

```text
submit-for-review
approve
integrate
```

The orchestration layer may decide WHICH existing operation is required.

The domain/application layer remains responsible for WHETHER the transition is valid.

This allows `px integrate` to be forgiving without making the state machine permissive.

---

# Part E — human override must become authoritative Review data

A human override must not remain only an `integrate` preflight boolean such as:

```text
approval.ok = true
```

that bypasses Review.

If a user explicitly overrides review, the override must be represented through the existing Review domain:

```text
human override
↓
ReviewerDecision(kind=approved, decidedAt=T)
↓
Mission approve
review → integration @ T
```

If a supported human-review operation already exists, invoke it.

Do not create an integration-specific shadow approval record.

Do not invent a fake provider review if the existing domain already supports local/human decisions.

---

# Part F — use the authoritative decidedAt during recovery

Recovery observes a previously happened approval late.

It does not cause the approval late.

Therefore:

```text
Mission.status = review
Review approved @ 10:30
px integrate runs @ 14:00
```

must persist:

```text
review → integration @ 10:30
```

not:

```text
review → integration @ 14:00
```

Use:

```text
ReviewerDecision.decidedAt
```

from the authoritative current Review round.

Never use:

```text
new Date()
Backlog file timestamp
integration start time
PR timestamp
Git commit timestamp
```

as the approval time.

---

# Part G — make review → done impossible

Harden the Mission domain.

The `integrate` command must require:

```text
Mission.status = integration
```

Only.

Remove acceptance of:

```text
Mission.status = review
```

for `integrate`.

Required:

```text
review
→ approve
→ integration
→ integrate
→ done
```

Direct:

```text
review → done
```

must be a domain error.

This is important because it prevents a stale/missing approval transition from being silently hidden by integration.

`px integrate` must repair the missing intermediate states instead.

---

# Part H — delete obsolete external statistics inference

Remove current production inference of implementer/reviewFixRounds from external representations such as equivalents of:

```text
deriveImplementerAndFixRoundsFromPrComments
deriveFinalImplementerFromBranchHistory
deriveFixRoundsFromReviewStateHistory
deriveFixRoundsFromTaskText
```

Delete these helpers if they no longer have a valid contemporary production caller.

Delete associated imports/dependencies/tests whose only purpose is preserving this obsolete behavior.

Do NOT replace them with:

```text
legacyReviewFallback
bestEffortFixRounds
inferReviewStats
historicalMissionMetadata
```

The goal is to remove the second truth source.

---

# Part I — historical stored statistics do not justify live inference

Existing old measurement rows in SQLite may continue to be read as stored measurements.

This mission does NOT need to recompute them.

There is no requirement to rerun ancient incomplete Missions using missing Review aggregates.

Therefore:

```text
historical persisted measurements
```

are NOT a reason to retain:

```text
live PR/Git/task-text reconstruction
```

If a current Mission lacks authoritative Review information, fix/recover the Mission workflow or report the invariant violation.

Do not reconstruct domain truth from text artifacts.

---

# Part J — contemporary stats require authoritative Mission/Review

`deriveImplementerAndFixRounds` or its successor must operate from authoritative Mission/Review state.

Do not make `MissionStore` optional in a way that changes semantics.

Bad:

```text
MissionStore missing
→ assume no Review
→ run legacy inference
```

Correct:

```text
Mission/Review required
→ caller must provide it
```

Possible small clean forms include:

```text
deriveImplementerAndFixRounds(mission)
```

or:

```text
deriveImplementerAndFixRounds(slug, requiredMissionStore)
```

Choose the smallest fit with current architecture.

Fix callers that currently omit the Mission authority.

Do not compensate inside the function.

---

# Part K — canonical reviewFixRounds

Derive reviewFixRounds only from the authoritative Review aggregate.

Required semantics:

```text
approved on first review
→ known 0

2 request-changes cycles then approval
→ known 2

genuinely insufficient authoritative evidence
→ unknown
```

Do not derive from:

```text
number of commits
task text
PR comments
branch naming
telemetry stage count
```

Known zero must remain distinct from unknown.

Preserve TASK-2371 aggregation semantics:

```text
[0, 2, unknown, unknown]
→ values [0,2]
→ n=2
→ average 1.00
```

---

# Part L — canonical implementer

Derive the final implementer from authoritative Mission/Review data.

Do not infer implementer from:

```text
commit author
branch history
Backlog prose
PR commenter
```

If the authoritative Review cannot provide it:

```text
unknown/unavailable
```

according to the existing measurement contract.

Do not guess.

---

# Part M — exact lifecycle-statistics proof

Use deterministic times:

```text
10:00 active work complete / review entered
10:30 authoritative review approval
14:00 px integrate invoked
14:15 integration lands
```

Persist the actual workflow.

Expected lifecycle:

```text
review → integration @ 10:30
integration → done @ 14:15
```

Expected dwell statistics:

```text
review      = 30 minutes
integration = 225 minutes
```

Assert these exact values through the same lifecycle projection consumed by Board/FLOW.

Do not merely assert the intermediate statuses exist.

---

# Required regressions

## R1 — normal review approval updates Mission immediately

Run the real supported review approval path.

Assert before calling `px integrate`:

```text
Review = approved
Mission.status = integration
```

and persisted event:

```text
review → integration
occurredAt = ReviewerDecision.decidedAt
```

---

## R2 — delayed integration dwell

Use:

```text
review start = 10:00
approval = 10:30
px integrate = 14:00
land = 14:15
```

Assert:

```text
review dwell = 30m
integration dwell = 225m
```

Old integration-time timestamping must fail this test.

---

## R3 — stale review recovery

Seed a partial/crashed state:

```text
Mission.status = review
Mission.review current decision = approved @ 10:30
```

Run `px integrate` at 14:00.

Assert:

```text
Mission becomes integration
review → integration occurredAt = 10:30
```

Then successful landing may produce:

```text
integration → done @ landed commit time
```

---

## R4 — stale active recovery with existing authoritative Review facts

Seed a valid recoverable state where Mission is stale in `active` but the workflow already contains sufficient authoritative facts to enter review.

Run `px integrate`.

Assert it invokes/reuses the existing transition chain:

```text
active → review
review → integration
```

before integration landing.

Do not directly patch statuses.

---

## R5 — active recovery via human override

Seed:

```text
Mission = active
no approved Review yet
explicit supported human override
```

Run `px integrate`.

Assert:

```text
authoritative Review created/updated
ReviewerDecision = approved
active → review
review → integration
```

through existing workflow operations.

Then normal integration may continue.

The test must assert that an authoritative Review decision exists.

---

## R6 — active without Review or override stops

Seed:

```text
Mission = active
no sufficient Review facts
no human override
```

Expected:

```text
px integrate fails clearly
Mission != done
```

No Git/PR/task-text inference is allowed.

---

## R7 — review without approval stops

Seed:

```text
Mission = review
Review exists but not approved
no override
```

Expected:

```text
px integrate stops
Mission remains review
```

---

## R8 — direct review → done forbidden

At domain level:

```text
Mission.status = review
command = integrate
```

must fail with the appropriate Mission rule violation.

---

## R9 — normal integration state remains simple

Seed:

```text
Mission.status = integration
```

`px integrate` must not re-run review/approval logic.

After landed integration:

```text
Mission.status = done
exactly one integration → done event
```

---

## R10 — first-pass approval reviewFixRounds

Authoritative Review:

```text
approved on first round
```

Expected:

```text
reviewFixRounds = 0
```

No external artifacts supplied.

---

## R11 — multiple fix rounds

Authoritative Review:

```text
round 1 changes requested
round 2 changes requested
round 3 approved
```

Expected:

```text
reviewFixRounds = 2
```

No external inference supplied.

---

## R12 — no external inference

Make PR/Git/Backlog fallback sources contain deliberately misleading values.

Authoritative Review says:

```text
reviewFixRounds = 2
implementer = terra
```

External artifacts imply something else.

Expected:

```text
reviewFixRounds = 2
implementer = terra
```

Ideally assert those external fallback readers were never invoked.

---

## R13 — missing Review cannot activate heuristic inference

For a contemporary statistics derivation with missing authoritative Review:

Expected:

```text
unknown / invariant error
```

according to chosen API semantics.

Assert:

```text
no PR lookup
no branch-history lookup
no task-text lookup
no fabricated zero
no fabricated implementer
```

---

# Old-bug sensitivity

For critical tests document why the previous behavior fails.

## R2/R3

Temporarily use:

```text
new Date()
```

for approval transition.

Expected test failure:

```text
review dwell becomes too large
integration dwell too small
```

## R8

Temporarily allow `integrate` from `review`.

The test must turn red.

## R12/R13

Temporarily restore one obsolete PR/Git/task-text fallback.

The tests must detect its use or changed result.

Do not commit mutations.

---

# Contradiction sweep

Before closing search relevant code for:

```text
requireStatus(mission, ['review', 'integration'
command: { type: 'submit-for-review'
command: { type: 'approve'
command: { type: 'integrate'
decidedAt
new Date().toISOString()
deriveFixRoundsFromTaskText
deriveFixRoundsFromReviewStateHistory
deriveFinalImplementerFromBranchHistory
deriveImplementerAndFixRoundsFromPrComments
branch-history
pr-comments
backlog-fallback
MissionStore?
```

Classify each relevant match.

Required final semantics:

## Normal lifecycle

```text
active
→ review
→ integration
→ done
```

## Normal approval timestamp

```text
ReviewerDecision.decidedAt
```

## Recovery

`px integrate` can orchestrate missing existing transitions but does not duplicate their domain rules.

## Completion

Only:

```text
integration → done
```

## Review statistics

Only authoritative Mission/Review state.

---

# Anti-slop constraints

## Do not make px integrate strict at the orchestration boundary

It must remain able to repair valid stale:

```text
active
review
integration
```

states.

Strictness belongs to individual domain transitions.

## Do not add active → integration or active → done shortcuts

Recovery must invoke:

```text
submit-for-review
approve
integrate
```

in sequence as required.

## Do not reimplement submit-for-review rules in integrate.ts

Call/reuse the existing workflow operation.

## Do not reimplement approval rules in integrate.ts

Use the existing authoritative Review/approval path.

## Do not invent a human-override boolean as lifecycle authority

Human override must result in a real Review decision.

## Do not use current time for recovered historical transitions

Use the timestamp of the authoritative source event.

## Do not keep obsolete stats inference "just in case"

No relevant old Missions require it.

Historical DB rows do not depend on live inference helpers.

## Do not replace deleted heuristics with different heuristics

No Git, PR, Backlog or telemetry reconstruction of Review truth.

## Do not broaden into TASK-2372 structural cleanup

Make only the structural changes required to establish the authoritative boundaries.

---

# Acceptance Criteria

* [ ] AC01 Baseline SHA and working-tree state recorded.
* [ ] AC02 Normal authoritative Review approval transitions Mission `review → integration` immediately.
* [ ] AC03 Approval lifecycle event uses exactly `ReviewerDecision.decidedAt`.
* [ ] AC04 Every supported authoritative approval path follows the same lifecycle invariant.
* [ ] AC05 Human override is persisted as authoritative Review data, not only an integrate-local flag.
* [ ] AC06 Backlog approval does not become an independent lifecycle authority.
* [ ] AC07 `px integrate` supports recovery from `active`.
* [ ] AC08 Active recovery uses existing `submit-for-review` workflow rather than direct status mutation.
* [ ] AC09 Active recovery uses existing Review/approval workflow rather than direct status mutation.
* [ ] AC10 Active with insufficient Review facts and no override stops clearly.
* [ ] AC11 `px integrate` supports recovery from stale `review` with an already-approved Review.
* [ ] AC12 Review recovery uses stored `ReviewerDecision.decidedAt`.
* [ ] AC13 Review without approval/override cannot integrate.
* [ ] AC14 `px integrate` from `integration` proceeds without rerunning approval.
* [ ] AC15 Direct domain `review → done` is impossible.
* [ ] AC16 `integrate` domain command requires `status=integration`.
* [ ] AC17 Successful lifecycle is `active → review → integration → done` as applicable.
* [ ] AC18 Failed landing never creates `done`.
* [ ] AC19 Exact delayed fixture produces review dwell=30m.
* [ ] AC20 Exact delayed fixture produces integration dwell=225m.
* [ ] AC21 Contemporary review statistics require authoritative Mission/Review data.
* [ ] AC22 Missing MissionStore cannot activate heuristic inference.
* [ ] AC23 PR-comment reviewFixRounds inference is removed.
* [ ] AC24 Git/branch-history reviewFixRounds inference is removed.
* [ ] AC25 Backlog task-text reviewFixRounds inference is removed.
* [ ] AC26 External implementer inference is removed where it served only as Review fallback.
* [ ] AC27 Obsolete fallback helpers are deleted when no valid callers remain.
* [ ] AC28 Stats dependencies used solely for obsolete fallbacks are removed.
* [ ] AC29 First-pass authoritative approval yields known reviewFixRounds=0.
* [ ] AC30 Two request-changes cycles yield known reviewFixRounds=2.
* [ ] AC31 Missing authoritative evidence never becomes reviewFixRounds=0.
* [ ] AC32 Canonical implementer comes from authoritative current Mission/Review data.
* [ ] AC33 Existing historical SQLite measurements need no rewrite.
* [ ] AC34 No compatibility is retained solely for obsolete pre-cutover Missions.
* [ ] AC35 TASK-2371 weekly Agent Performance semantics remain unchanged.
* [ ] AC36 PR-fix observation-count semantics remain unchanged.
* [ ] AC37 Telemetry remains unrelated to Mission completion authority.
* [ ] AC38 No new recovery state machine or review inference framework is introduced.
* [ ] AC39 R2/R3/R8/R12 or equivalent tests demonstrate old-bug sensitivity.
* [ ] AC40 No agent, LLM, mission runner or network is required by certification tests.
* [ ] AC41 `git diff --check` passes.
* [ ] AC42 `./scripts/verify-local.sh all` passes.
* [ ] AC43 No focused or unannotated skipped tests are introduced.

---

# Required checkpoints

## Checkpoint 0 — baseline and path inventory

Record:

```text
BASELINE_SHA
git status
```

Trace all current:

```text
review approval paths
human override path
Mission submit-for-review
Mission approve
px integrate preflight/recovery
MissionIntegrationService
reviewFixRounds derivation
implementer derivation
external inference callers
```

---

## Checkpoint 1 — determine contemporary workflow invariants

Prove from current domain/application code whether a normal Mission can legitimately reach integration without a Review aggregate.

Expected:

```text
no
```

If there IS a genuine supported current workflow without Review, document it before deleting fallbacks and adapt this mission narrowly.

Do not preserve inference just because a caller currently forgot to provide MissionStore.

---

## Checkpoint 2 — red lifecycle timing tests

Add R1–R3 and R8.

Capture exact baseline failures.

---

## Checkpoint 3 — move normal approval to authoritative boundary

Make Review approval transition Mission into integration using `decidedAt`.

Cover all supported approval producers.

---

## Checkpoint 4 — implement recovery orchestration

Make `px integrate` reconcile stale:

```text
active
review
integration
```

using existing authoritative operations.

No shortcut transitions.

---

## Checkpoint 5 — harden integrate domain rule

Require:

```text
Mission.status = integration
```

for Mission `integrate`.

Run active/review/integration recovery regressions.

---

## Checkpoint 6 — delete obsolete stats inference

Remove PR/Git/task-text fallback inference and optional-authority behavior.

Fix callers to provide authoritative Mission/Review.

---

## Checkpoint 7 — Review metric certification

Run R10–R13.

Prove genuine zero, non-zero and missing evidence semantics without external inference.

---

## Checkpoint 8 — lifecycle statistics proof

Run persisted lifecycle projection for:

```text
10:00 review
10:30 approve
14:00 integrate command
14:15 done
```

Assert:

```text
review      30m
integration 225m
```

---

## Checkpoint 9 — contradiction/dead-code sweep

Search and classify all patterns above.

Delete obsolete imports/tests/helpers.

---

## Checkpoint 10 — full verification

Run:

```bash
git diff --check
./scripts/verify-local.sh all
```

---

# Definition of Done

Before marking done, answer with concrete evidence:

1. When does a normal Mission now leave `review`?
2. Does the lifecycle event timestamp equal `ReviewerDecision.decidedAt`?
3. If integration starts hours later, is that wait correctly counted as integration dwell?
4. Can `px integrate` recover a stale `active` Mission without inventing transitions?
5. What authoritative facts are required for active recovery?
6. Can human override recovery create a real Review decision?
7. Can `px integrate` recover a stale approved `review` Mission using the original approval timestamp?
8. Can Mission `integrate` ever execute directly from `review`?
9. Can current stats derive reviewFixRounds from PR comments?
10. Can current stats derive reviewFixRounds from Git history?
11. Can current stats derive reviewFixRounds from Backlog text?
12. What happens when current authoritative Review data is unavailable?
13. Does first-pass approval produce known zero?
14. Do two requested-fix cycles produce exactly two?
15. Does the full verifier pass?

Provide:

| Requirement                            | Result    | Production evidence | Regression evidence | Old-bug sensitivity |
| -------------------------------------- | --------- | ------------------- | ------------------- | ------------------- |
| approval transition at Review boundary | PASS/FAIL | file:line           | test                | explanation         |
| approval timestamp = decidedAt         | PASS/FAIL | file:line           | test                | explanation         |
| active recovery via existing workflow  | PASS/FAIL | file:line           | test                | explanation         |
| review recovery via existing approval  | PASS/FAIL | file:line           | test                | explanation         |
| human override becomes Review data     | PASS/FAIL | file:line           | test                | explanation         |
| review→done impossible                 | PASS/FAIL | file:line           | test                | explanation         |
| review dwell exact                     | PASS/FAIL | file:line           | test                | explanation         |
| integration dwell exact                | PASS/FAIL | file:line           | test                | explanation         |
| PR fallback removed                    | PASS/FAIL | source/search       | test                | explanation         |
| Git fallback removed                   | PASS/FAIL | source/search       | test                | explanation         |
| Backlog-text fallback removed          | PASS/FAIL | source/search       | test                | explanation         |
| authoritative reviewFixRounds          | PASS/FAIL | file:line           | tests               | explanation         |
| authoritative implementer              | PASS/FAIL | file:line           | tests               | explanation         |
| full verifier                          | PASS/FAIL | command             | command             | —                   |

Do not mark the mission done while any row is FAIL.

---

# Out of Scope

* historical DB repair;
* migration/backfill of obsolete pre-cutover Missions;
* preserving execution of ancient Missions lacking Review aggregates;
* dashboard redesign;
* new statistics;
* telemetry architecture changes;
* TASK-2372 integrate-file consolidation beyond changes required by this mission;
* general stats.ts cleanup;
* Review-domain redesign;
* real-agent E2E;
* network-backed tests.
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

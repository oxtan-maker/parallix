---
id: TASK-2652
title: >-
  Validate fresh-context rebound recovery by replaying historical Ornith failed
  repairs
status: done
assignee: [claude]
created_date: '2026-10-05 19:16'
updated_date: '2026-10-08'
labels:
  - evaluation
dependencies: []
references:
  - >-
    backlog/completed/task-2588 -
    Escalate-failed-rebounds-to-fresh-context-diagnostic-repair.md
  - >-
    backlog/completed/task-2575 -
    Give-self-development-gate-rebounds-authority-to-repair-the-failing-defence.md
  - src/application/rebound-kernel.ts
  - >-
    backlog/tasks/task-2653 -
    Record-each-rebound-repair-attempt-as-durable-recovery-telemetry.md
priority: medium
ordinal: 164008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Agreed mission scope

Compare fresh diagnostic context with resumed historical Ornith conversations on
real failures, restoring their exact tracked code and Parallix infrastructure.
The original strict failed-first-rebound screen found insufficient cases. The
operator authorized a broader six-case comparison, including four new failures
and clean repeats of two pilot missions. One Ornith replay at a time; regular
missions may run concurrently. No production recovery-policy change.

Keep only a concise research summary in this repository at
`tools/recovery-context-evaluation/report.md`. Move the harness, tests, datasets,
charts and raw evidence to `../parallix-article-data-task-2652/`, preserving their
provenance and original read paths. Do not publish the article or run more model
arms for closeout.

Both arms use the served mradermacher MTP Ornith artifact; historical sessions
must remain exclusively AtomicChat Ornith. Declare that artifact difference and
current Pi/Node. Match tree, prompt, path, dependencies, tools and permissions
within each pair, with 600 seconds and 60 turns. Require historical red 3/3 and
green on the complete historical repair. Preserve original sessions and hide
operator state and reference answers with filesystem confinement; changing
operator database hashes during regular missions are not the expanded study's
isolation criterion.

Retain every final arm, including timeouts, unfinished commits and semantic
rejections. A focused green check does not imply a valid delivered repair.
Inspect changed assertions and adjacent behavior. Report historical full-gate
environment failures separately, and separate checkpoint evidence from code/test
repairs. The article-readiness judgment is descriptive and bounded.

## Execute closeout

The operator authorized reconciling the recorded Mission with this agreed scope.
Record checkpoint evidence and criterion completion through supported px writes,
using the current Mission version for each write. Preserve Backlog lifecycle
metadata and let the normal lifecycle own review/integration decisions. The
research harness itself continues to have no px invocation or operator DB write.

Required gates remain `./scripts/verify-local.sh all` and
`./scripts/verify-local.sh static-analysis`; documentation must also pass
`./scripts/verify-local.sh docs`. Keep real verification results and evidence in
the recorded checkpoints. The twelve historical replays and inspected snapshots
supply the manual end-to-end research verification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Preserve the original strict screen and its insufficient-case result; identify the six distinct expanded cases without counting earlier pilots or interrupted runs as extra observations.
- [x] #2 Complete twelve sequential Ornith replay arms with historical red 3/3 and green-on-reference validation, matching tree/prompt/model controls and preserved original sessions.
- [x] #3 Classify focused checks separately from committed repairs after contract inspection; retain failures, timeouts and semantic rejections, with checkpoint work separated from code/test cases.
- [x] #4 Report paired outcomes, input/cached/output token totals and medians, duration, model/runtime and snapshot-environment limitations, and the omitted normal compact-first baseline; judge bounded article readiness without changing production policy.
- [x] #5 Keep only the research summary in this repository and preserve harness, datasets, charts and raw evidence in ../parallix-article-data-task-2652/ with provenance and original read-path aliases.
- [x] #6 Run the declared all and static-analysis gates plus documentation checks; record evidence for every planned checkpoint and criterion, commit the final deliverables, and leave review/integration to lifecycle machinery.
<!-- AC:END -->



## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 All planned checkpoints recorded with px; final checkpoint covers every criterion using verifiable repository references and gate commands
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [x] #6 Bug reproduction requirement: not applicable to this evaluation-only mission; no production bug fix
<!-- DOD:END -->

---
id: TASK-2357
title: >-
  Fix statistics correctness defects (historical flow, repository identity,
  nullable reviewFixRounds, completion semantics) and replace certification test
status: done
assignee: [claude]
created_date: '2026-08-10 00:00'
labels:
  - bug
  - user_value
  - stats
  - correctness
dependencies: []
references:
  - backlog/tasks/task-2353 - (parent mission, verification requirement not met)
  - lib/commands/stats.ts
  - lib/stats/
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Residual review of TASK-2353 identified four correctness defects plus one
verification-process gap. Statistics output cannot be trusted for experiment
comparison until these are fixed.

### Defect 1 — Historical cumulative flow seeds missions before intake (future-information leak)

`historicalInitialStates` filter checks `transition.from === null` to skip
seeding a mission from today's current state when it has an intake event.
That condition is dead logic: `MissionTransition.from` is statically
`MissionStatus` (non-nullable). Production conversion normalizes
`null → backlog` into `backlog → backlog` via
`from: entry.fromStatus ?? entry.toStatus`.

Consequence: when rendering historical weeks, missions not yet intaked
are seeded from today's status. Historical cumulative flow contains
missions before they existed.

Fix: filter must check whether the mission has *any* intake transition
(e.g. one whose original source was null or whose first event is an
intake), not whether `from === null`.

### Defect 2 — `px stats cohorts` does not use canonical repository identity

`statsCohorts()` defaults to:
`const rootDir = options.rootDir ?? process.cwd()` and
`toRepositoryId(parsed.repositoryId ?? rootDir)`.
From `/tmp/parallix-task-2353` this literally becomes the path string.
Mission composition resolves worktrees to the primary checkout and stores
the owning repository identity there. Normal stats export passes
`opts.repositoryId` through without canonical injection. Normal statistics
writing has yet another resolver: `product.name || path.basename(rootDir)`.

TASK-2353's requirement "one canonical repository resolver" is not
satisfied. Blocker for worktree operation.

Fix: inject canonical repository ID into `statsCohorts()` and every
stats entry point. No `process.cwd()` fallback.

### Defect 3 — `reviewFixRounds` null→0 coercion fabricates measurements

Producer correctly emits `prFixRounds: null` when count is unknown.
Persistence canonicalization does `Number.parseInt(...) || 0` for all
`USAGE_NUMBERS`, so `null → 0`. Reading back does same. Board adapter
adds `record.pr_fix_rounds ?? 0`. Domain model makes
`reviewFixRounds: number` (mandatory). Cohort statistics report
`observationCounts.reviewFixRounds = members.length` because every
fabricated zero looks like a measurement.

Consequence: 20 missions, 7 known, 13 unknown → average/median computed
over n=20 (13 fabricated zeros included) instead of n=7. Materially
distorts experiment comparison.

Fix: `reviewFixRounds` must be nullable/measurement value end-to-end,
like runtime/cost/tokens. Persistence, domain model, adapter, and cohort
counting must all preserve `null`.

### Defect 4 — Board and `px stats` disagree on "completed mission"

Board: lifecycle is delivery authority. Mission reaching `done` counts
even with no telemetry.

`px stats` (weekly/range): `row.closed === 'yes'` from telemetry rows.
Mission reaching `done` but telemetry write fails → board says completed,
`px stats` says not completed.

Fix: converge `px stats` mission-flow reports onto lifecycle completion,
or explicitly rename existing reports as "agent telemetry reports" so
they no longer claim the same semantic quantity.

### Defect 5 — Legacy lifecycle-entry fallback can cross repositories (medium)

For missions without lane transitions, adapter falls back to
`historyRepo.findAll()` matched only on `data.missionId === missionId`.
No repository predicate. Overlapping mission IDs across repos (A/task-123,
B/task-123) can cause wrong lifecycle-entry timestamp.

Fix: add repository filter to legacy fallback query.

### Defect 6 — Zero-week handling: zero completions with active missions returns unavailable (medium)

`if (outcomes.length === 0) { return empty / skip; }` runs before the
"add current week = 0" logic. 12 active missions + 0 ever completed →
board says "weekly completions unavailable" instead of genuine 0.

Fix: distinguish "no lifecycle activity" from "lifecycle activity exists
but current week has zero completions."

### Defect 7 — Per-metric low-sample judgement not per-metric (medium)

Cohort model carries separate counts per metric. `lowSample` still uses
`members.length < threshold`. So cohort n=30, cost n=2 is not marked
low-sample even though cost comparison is based on two observations.

Fix: compute `lowSample` per metric using its own `observationCount`.

### Verification gap — TASK-2353 certification test is not production-path proof

Current test: manually constructs `initialStates`, starts with
`backlog → active` (not `null → backlog`), manually converts events to
transitions, calls `buildMetrics()` directly, checks mostly for
populated/non-empty metrics. Bypasses the exact production conversion
that destroys the null information.

This is exactly the test strategy TASK-2353 said must not be accepted as
certification. Defect 1 survived because of this gap.

Fix: replace with production-path test instantiating
`BoardProjectionBuilder` + `ConcreteMetricsReadAdapter`, exercising
nullable intake conversion, cross-repository fixture, and worktree path.
Checks hand-calculated values, not just "is numeric."
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Historical cumulative flow does not seed missions from today's state before their intake event; filter uses intake-transition detection, not `from === null`
- [ ] #2 `statsCohorts()` receives canonical repository ID from a single resolver; no `process.cwd()` or path-based fallback on any stats entry point
- [ ] #3 `reviewFixRounds` preserves `null` through persistence, domain model, adapter, and cohort counting; unknown missions excluded from review-fix averages and from `observationCounts.reviewFixRounds`
- [ ] #4 Board and `px stats` use same completion definition (lifecycle `done`), or `px stats` reports are explicitly renamed "telemetry reports" with help text reflecting the distinction
- [ ] #5 Legacy lifecycle-entry fallback query includes repository predicate; overlapping mission IDs across repos do not cross-contaminate
- [ ] #6 Zero completions with known lifecycle activity renders as measured zero (not unavailable)
- [ ] #7 Per-metric `lowSample` flag uses that metric's own `observationCount`, not cohort member count
- [ ] #8 Certification test instantiates `BoardProjectionBuilder` + `ConcreteMetricsReadAdapter`, exercises `null → backlog` intake normalization, includes cross-repository worktree fixture, and asserts hand-calculated values (not just "is numeric")
<!-- AC:END -->

## Implementation Plan

1. Fix `historicalInitialStates` filter to detect intake transitions (check for first event or original null source, not `from === null`).
2. Wire canonical repository resolver into `statsCohorts()` and all stats entry points; remove `process.cwd()` fallback.
3. Make `reviewFixRounds` nullable end-to-end: persistence (`USAGE_NUMBERS`), domain model, board adapter, and cohort observation counts.
4. Converge `px stats` completion onto lifecycle `done` or rename reports explicitly.
5. Add repository filter to legacy lifecycle-entry fallback query.
6. Fix zero-week early-return to distinguish "no activity" from "zero completions."
7. Compute per-metric `lowSample` from per-metric `observationCount`.
8. Replace certification test with production-path fixture (BoardProjectionBuilder + ConcreteMetricsReadAdapter, nullable intake, cross-repo worktree, hand-calculated assertions).
9. Run static-analysis gate on all changed files.

## NEL Estimate

Medium (80–240 NEL): 7 code defects across persistence, domain, adapter, and CLI layers plus one test rewrite. No new dependencies.

## Agent-completeness guardrails

- Do not merge defects 1-4 into a single diff. Each defect gets its own
  commit with a reproduction test that fails before and passes after.
- Defect 3 (`reviewFixRounds` nullable) must be verified by checking
  actual cohort output: `observationCounts.reviewFixRounds` must be
  strictly less than `members.length` when any mission has unknown
  review-fix count. Print the count to proof.
- Defect 1 (historical flow) must be verified with a multi-mission
  fixture: Task A intake Monday, Task B intake Thursday, Task B = done
  today. Assert Task B is absent from Monday/Tuesday/Wednesday history.
- Defect 2 (repository identity) must be verified by running from a
  worktree (e.g. `/tmp/parallix-task-2357`) and confirming the cohort
  repository ID matches the primary checkout's canonical ID, not the
  worktree path.
- The certification test (AC #8) must fail on the pre-fix tree. If the
  new test passes before code changes, the test is still SC6-style and
  must be rewritten.
- Do not introduce `elapsedMinutes()` malformed-timestamp rejection or
  projection-clock injection in this mission. Those are separate smells,
  not correctness blockers for experiment comparison.
- Do not accept "series is non-empty" or "value is numeric" as
  certification. Tests must assert hand-calculated values against known
  fixtures.
- Stop for human direction if `reviewFixRounds` nullability requires
  database migration or schema change (current assessment assumes it
  does not).

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
- [ ] #7 Certification test (AC #8) fails on pre-fix tree and passes on final tree with hand-calculated assertions
<!-- DOD:END -->

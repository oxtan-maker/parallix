---
id: TASK-2421
title: Measure the third post-boundary 20-completed-mission cohort
status: backlog
assignee: [claude]
created_date: '2026-08-27 00:00'
labels:
  - ai_sdlc
  - architecture
  - reliability
  - metrics
dependencies:
  - TASK-2361
references:
  - docs/adr/0051-ui-neutral-application-boundary.md
  - backlog/completed/task-2322 - recover-agent-slop-alinging-with-domain-design.md
  - missions/task-2361/cohort-ledger.json
  - missions/task-2361/cohort-measurement.json
  - scripts/bug-frequency-report.ts
  - src/application/projections/bug-frequency.ts
priority: high
ordinal: 88913
---

## Description

ADR 0051's third post-integration reliability measurement. TASK-2361 measured
cohort 2 — the first 20 unique missions that durably entered `backlog/completed/`
strictly after cohort 1's last member, TASK-2233 (transition commit
`1c9e40f41`, 2026-07-26T06:53:33+02:00) — and published 20 completed / 6 bug /
14 non-bug, `bug / total` 30.0%, `100 * bug / non-bug` 42.86, against ADR 0051's
unchanged baseline of 39 / 129 (30.2%) and 43.3 bugs per 100 non-bug missions.

Cohort 2's last member is TASK-2322 (transition commit
`d8628021e9d33d925718675914459e59fb689677`, 2026-07-29T06:04:42+02:00). This
task measures cohort 3: the next 20 unique missions that durably enter
`backlog/completed/` strictly after TASK-2322's transition commit. Cohort 2's
boundary, the ADR 0051 baseline, and the frozen tie-breaker are frozen inputs
and must not be re-derived to obtain a better comparison.

The report is no longer a one-off script: `scripts/bug-frequency-report.ts`
plus the pure module `src/application/projections/bug-frequency.ts` (with
`test/task-2361-bug-frequency.test.ts`) implement TASK-2289 acceptance
criterion #8. Enumerate with:

```
tsx scripts/bug-frequency-report.ts --enumerate d8628021e9d33d925718675914459e59fb689677 --ref main
```

or freeze a ledger first with
`git log --reverse --no-renames --diff-filter=A --format=C|%H|%cI|%s --name-only d8628021..main -- backlog/completed/`
and feed it to the runner with `--ledger`.

## Acceptance Criteria

- [ ] #1 Cohort 3 is the first 20 unique missions durably entering
     `backlog/completed/` strictly after TASK-2322's transition commit
     `d8628021`, selected with the same tie-breaker recorded in
     `missions/task-2291/cohort-ledger.json`; if fewer than 20 exist, report the
     exact eligible and remaining counts and stop
- [ ] #2 The report reproduces the three separate series (ADR 0051 baseline,
     cohort 2, cohort 3) without summing, averaging, or pooling them
- [ ] #3 A two-cohort trend claim between cohort 2 and cohort 3 is made only if
     both point the same direction relative to the baseline; otherwise the result
     is reported as inconclusive without a speed or throughput qualification
- [ ] #4 The measurement reads repository data only and mutates no task labels,
     statuses, or workflow state

## Implementation Plan

1. Enumerate `d8628021..main -- backlog/completed/` with the frozen
   `git log --reverse --no-renames --diff-filter=A` command, dedupe by task ID,
   apply the frozen tie-breaker, take the first 20, and write a cohort-3 ledger.
2. Run `scripts/bug-frequency-report.ts --ledger` against the cohort-3 ledger to
   reproduce cohort 2's published 20 / 6 / 14 as a self-check, then compute
   cohort 3.
3. Publish the cohort-3 measurement alongside cohort 2 and the ADR 0051
   baseline, with calibrated SC6 language, and link this successor.

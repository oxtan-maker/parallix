---
id: TASK-2361
title: Measure the second post-boundary 20-completed-mission cohort
status: backlog
assignee: [claude]
created_date: '2026-08-11 00:00'
labels:
  - ai_sdlc
  - architecture
  - reliability
  - metrics
dependencies:
  - TASK-2291
references:
  - docs/adr/0051-ui-neutral-application-boundary.md
  - backlog/completed/task-2289 - Extract-UI-neutral-application-contracts-and-composition.md
  - missions/task-2291/cohort-ledger.json
  - missions/task-2291/cohort-measurement.json
  - missions/task-2291/audit-cohort.mjs
priority: high
ordinal: 88912
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Own ADR 0051's second post-integration reliability measurement. TASK-2291
measured cohort 1 — the first 20 unique missions that durably entered
`backlog/completed/` after TASK-2290's integration commit
`8aa9af505ff2f22ac35448dab62b2c7cc7a125cb` (2026-07-21T14:26:24+02:00) — and
published 20 completed / 4 bug / 16 non-bug, `bug / total` 20.0%,
`100 * bug / non-bug` 25.0, against ADR 0051's unchanged baseline of 39 / 129
(30.2%) and 43.3 bugs per 100 non-bug missions.

ADR 0051 requires two post-integration cohorts before any trend claim, so
cohort 1's lower rate is an early signal only. This task measures cohort 2:
the next 20 unique missions that durably enter `backlog/completed/` strictly
after cohort 1's last member, TASK-2233 (transition commit `1c9e40f41`,
2026-07-26T06:53:33+02:00). Cohort 1's boundary, membership, denominator,
label rule, and the ADR baseline are frozen inputs and must not be re-derived
to obtain a better comparison.

Blocking gap carried over from TASK-2291: TASK-2289 acceptance criterion #8
required a reproducible, read-only bug-frequency report, and no implementation
of it exists in any revision of this repository. TASK-2291 substituted two
agreeing hand-written read-only recomputations
(`missions/task-2291/audit-cohort.mjs` plus an independent `awk` pass). This
task must either deliver that report as a first-class command or record an
explicit decision that the repeated measurement stays script-based.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Cohort 2 is the first 20 unique missions durably entering `backlog/completed/` strictly after TASK-2233's transition commit `1c9e40f41`, selected with the same tie-breaker recorded in `missions/task-2291/cohort-ledger.json`; if fewer than 20 exist, report the exact eligible and remaining counts and stop
- [ ] #2 Classification uses only the exact `bug` label, unions labels across duplicate task-file copies, and recomputes labels at report time
- [ ] #3 The report publishes total, bug count, non-bug count, `bug / total`, `100 * bug / non-bug`, all included task IDs, cohort 1's 20 / 4 / 16 result, and ADR 0051's unchanged 39 / 129 (30.2%) baseline as three separately compared series
- [ ] #4 Either TASK-2289's missing bug-frequency report is implemented with fixture tests for duplicate copies, later-added labels, malformed-frontmatter warnings, and fail-closed ambiguous classification, or a recorded decision keeps the measurement script-based
- [ ] #5 A two-cohort trend claim is made only if both cohorts point the same direction; otherwise the result is reported as inconclusive without a speed or throughput qualification
- [ ] #6 The measurement reads repository data only and mutates no task labels, statuses, or workflow state
<!-- AC:END -->

## Implementation Plan

1. Re-run `node missions/task-2291/audit-cohort.mjs` semantics against a cohort-2 ledger built from `1c9e40f41..main`.
2. Decide and execute on the missing TASK-2289 report (implement or record the script-based decision).
3. Publish cohort 2 alongside cohort 1 and the ADR 0051 baseline, with calibrated language.
4. Create or link the cohort-3 measurement, or an automated recurring report that takes over ADR 0051's requirement.

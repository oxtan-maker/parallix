---
id: TASK-2291
title: Measure post-boundary bug-frequency cohort
status: backlog
assignee: [codex]
created_date: '2026-07-20 00:00'
labels:
  - architecture
  - reliability
  - metrics
dependencies:
  - TASK-2290
references:
  - docs/adr/0051-ui-neutral-application-boundary.md
  - backlog/tasks/task-2289 - Extract-UI-neutral-application-contracts-and-composition.md
  - backlog/tasks/task-2290 - Delegate-bounded-CLI-slices-through-application-boundary.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Own ADR 0051's first post-integration reliability measurement. This mission is
blocked until TASK-2290 is integrated and at least 20 unique missions have
reached the completed store after its integration boundary. Before that threshold, report the
remaining sample count and stop; do not extrapolate, substitute elapsed time,
or count pre-integration tasks.

Run the read-only bug-frequency report delivered by TASK-2289 against the first
20-completed-mission cohort. Publish the exact bug/non-bug numerator and denominator, bug
frequency, bugs per 100 non-bug completed missions, task IDs, cutoff commit/date, and task
mix. Separately identify bug-labelled tasks that touch the extracted
`stats-backfill` or `active` slices. Speed and throughput may be reported, but
cannot offset or be blended with bug frequency.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 The cohort begins strictly after TASK-2290's actual integration commit/date and contains the first 20 unique missions by durable transition into `backlog/completed/`, with deterministic tie breaking documented; task creation alone never admits a mission
- [ ] #2 Classification uses only the exact `bug` label, unions labels across duplicate task-file copies, and recomputes the cohort at reporting time so a later-added bug label is not hidden
- [ ] #3 The report publishes 20 completed total, bug count, non-bug count, `bug / total`, `100 * bug / non-bug`, all included task IDs, and the unchanged ADR baseline of 39 / 129 (30.2%) for comparison
- [ ] #4 The report separately lists completed bug missions touching `stats-backfill` or `active` with file/task evidence; it does not infer architectural causation from the aggregate ratio
- [ ] #5 Open/backlog/refined/active/review missions are excluded from both sides; after a mission enters the completed cohort it is not removed for being severe, reopened, later archived, or inconvenient; unambiguous malformed records are counted with a warning, while ambiguous completion/ID/date/label classification aborts instead of becoming a non-bug
- [ ] #6 The measurement reads repository data only and neither edits task labels/status nor launches agents, Forgejo, network calls, nested `px`, or expensive commands
- [ ] #7 Claims use calibrated language: lower than baseline is an early signal, one cohort is not a durable trend, and equal/higher frequency is reported without a speed-based qualification
- [ ] #8 Before completion, create or link the next 20-completed-mission cohort measurement unless an integrated automated recurring report already owns ADR 0051's requirement
<!-- AC:END -->

## Implementation Plan

1. Resolve and record TASK-2290's integration boundary.
2. Verify that 20 post-boundary completion transitions exist; stop without inference if not.
3. Run the TASK-2289 report and independently audit cohort membership and arithmetic.
4. Classify slice-related completed bug missions with evidence and publish the calibrated comparison.
5. Schedule the next cohort measurement and run the documentation/static checks relevant to any changed files.

## NEL Estimate

Small (0–80 NEL): read-only measurement evidence and its successor tracking.
Any production-code change is out of scope and requires a separate mission.

## Agent-completeness guardrails

- Do not change the observation start, completed-only denominator, baseline, cohort size, label definition,
  or deduplication rule to obtain a better result.
- Do not silently drop malformed records or use title keywords as a substitute
  for the exact `bug` label.
- Show the task-ID list and arithmetic. A prose claim such as “reliability
  improved” without reproducible numerator/denominator evidence is incomplete.
- Stop for human direction if TASK-2290's integration boundary is ambiguous or
  the report disagrees with an independent count.

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 The 20-completed-mission threshold and integration boundary are proven with repository references
- [ ] #2 Published arithmetic is reproducible from the included task-ID list
- [ ] #3 Aggregate and slice-specific findings are separated and caveated
- [ ] #4 No repository authority or task classification was mutated by measurement
- [ ] #5 The next cohort has an explicit owner
<!-- DOD:END -->

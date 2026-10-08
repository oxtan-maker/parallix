---
id: TASK-2689
title: >-
  Evaluate Jev report-content feedback on fresh rows and implement if it beats
  the baseline
status: backlog
assignee: []
created_date: '2026-10-08 07:54'
labels:
  - ai_sdlc
dependencies:
  - TASK-2659
references:
  - docs/adr/0065-local-review-classification-evidence.md
  - backlog/docs/task-2659-evidence/summary.md
priority: medium
ordinal: 193008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ADR 0065 option A: test whether Jev, run on submitted verification report text before general review, gives correct early feedback on rows it was not tuned on. TASK-2659 compared a deterministic rule with the reference checker and Jev. It found Jev matched 35 of 35 labels, but only on contrast-selected recorded packets whose question text was tuned on the development half, labelled by one reader, with no fresh run because the implementing terminal had no Jev credentials (the operator has Jev configured elsewhere). Deterministic rules were not implemented: missing-outcome precision 17 of 25, 15 of 39 failure/deferral/missing rows missed, mixed/quoted rows unwarnable.

Run Jev on a fresh stratified sample of historical Goal Check rows (failure, deferral, success, missing outcome, mixed, silent), with the prompt frozen and labels fixed before any Jev request. Score reference validity, report meaning and verified execution separately; no answer proves a command ran. Measure false favorable answers (the costly error), false warnings, abstentions/escalations, coverage and complete preparation/request/fallback time and cost, against the reference checker and the TASK-2659 rule results. Workflow stays Active → code checks → (Jev content check, if justified) → general LLM review; reference checks, executable gates and general review scope are unchanged.

Outcome is either (a) ADR 0065 records measured evidence that the hypothesis did not hold, with no code added, or (b) Jev report-content feedback is implemented through existing Parallix application ports, persistence and telemetry conventions, with on-demand comparison and a documented fail-safe for provider unavailability. Do not create committed report inventories or a parallel telemetry authority.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Run where Jev credentials are available; a fresh stratified sample is drawn with frozen prompt and labels fixed before any Jev request; sampling, seed and labelling method are recorded, and a subset is labelled or checked by the operator.
- [ ] #2 Results report false favorable answers, false warnings, abstentions, coverage, and end-to-end time and cost against the reference checker and the TASK-2659 rule results; raw disagreements and ambiguous cases stay visible.
- [ ] #3 Implement only if Jev shows demonstrated value beyond the baseline, with a false-favorable rate the operator accepts; otherwise ADR 0065 records the negative result and no code is added.
- [ ] #4 If implemented: early advisory or gating behavior, unavailable-provider fail-safe, telemetry and on-demand comparison use existing application ports and persistence; no reading is treated as proof of execution; focused checks in the owning suites cover the report-status contract and ambiguous inputs.
- [ ] #5 ADR 0065 and live docs are updated with the measured outcome and the decision, without implementation inventories.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

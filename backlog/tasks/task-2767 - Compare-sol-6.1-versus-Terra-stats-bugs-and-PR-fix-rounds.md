---
id: TASK-2767
title: 'Compare sol-6.1 versus Terra stats: bugs and PR fix rounds'
status: backlog
assignee: []
created_date: '2026-10-15 14:46'
labels:
  - ai_sdlc
dependencies: []
priority: high
ordinal: 254008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Compare existing recorded statistics for sol-6.1 (GPT-6.1 Sol) versus Terra. The operator is unimpressed with sol-6.1 and wants the observed numbers, particularly bugs produced and PR fix rounds.

Use existing mission, review, bug and model/provider records only. Do not run a new benchmark, launch agents, introduce an evaluation framework, adjust for task difficulty, or exclude workflow failures to improve either model's results. Resolve the actual recorded model identifiers for sol-6.1 and Terra, state the date range and sample sizes, and compare like recorded metrics side by side.

Report missions attempted/completed, recorded bugs attributable to each model where an explicit record links them, and PR fix/review rounds (totals, per-mission average, median and distribution where the data supports them). Distinguish initial review from subsequent fix rounds using the existing recorded semantics. Show missing model labels, missing bug attribution and incomplete reviews explicitly; do not invent attribution or treat missing data as zero. Provide the underlying mission IDs and reproducible read-only queries so the operator can check the numbers.

Deliver a concise stats comparison and state what the recorded counts show. No implementation changes, new metrics collection, causal study, recommendations framework or model reruns. Do not change real mission lifecycle state, gate configuration or historical records.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Side-by-side existing stats for sol-6.1 and Terra include date range and sample sizes
- [ ] #2 Compare recorded bugs and PR fix rounds with missing data explicitly shown
- [ ] #3 Read-only queries and underlying mission IDs make the counts reproducible; no new benchmark or agent runs
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

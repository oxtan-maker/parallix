---
id: TASK-2235
title: Human review submissions are not first-class in the parallix workflow
status: backlog
assignee: [codex]
created_date: '2026-07-12 09:40'
labels:
  - ai_sdlc
  - enhancement
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two problems surfaced from TASK-2213:

**1. The mission's fix broke the PR round calculation it was meant to correct**
TASK-2213 was activated because the "Agent performance this week" PR fix-round statistics were wrong. The table shows rows per model (e.g. `claude-sonnet-5`, `gpt-5.4`, `gpt-5.6-terra`), each with its own average PR fix rounds. The implementation's fix collapsed the grouping key from `model` to `normalizeImplementer(implementer)`, merging all models under one implementer family into a single row. This is a hallucination — it removes the split-by-model the report is supposed to show, and the PR round averages become meaningless since they're computed across mixed models rather than per model. The mission needs to be redone: fix the PR round calculation while preserving the per-model row split.

**2. Human review submissions produce no artifacts**
When an operator submits a manual review via `px review --submit-review request-changes --message "..."`, the command flips the disposition in `review-state.json` but does not generate `reviewer_outcome-*` or `reviewer_findings-*` event files under `missions/<slug>/review-events/`. The implementer agent relies on those artifacts to know what to fix. Without them, the agent hits the safety rule ("REQUEST_CHANGES without readable review outcome → BLOCKED") and stops, requiring operator intervention.

Human reviews need to be first-class: submitting a manual review should produce the same structured artifacts that an AI reviewer produces, so the implementer agent can act on them without blocking.

Specifically, `px review --submit-review request-changes --message "..."` should:
- Write `reviewer_outcome-<round>-human.md` with verdict `request-changes` and the operator's message
- Write `reviewer_findings-<round>-human.md` with the operator's message as actionable findings
- Increment the round counter in `review-state.json` so the next implementer pass treats it as a new round

Trigger: TASK-2213 — implementation collapsed model-level rows into implementer-family rows, breaking per-model PR round averages; operator's manual review produced no artifacts, causing claude to post BLOCKED.
<!-- SECTION:DESCRIPTION:END -->

## Codex Pre-Draft

**Goal:** restore per-model review-round statistics and make a human `request-changes` submission indistinguishable, to the implementer workflow, from a structured reviewer submission.

**Scope and proof:** first add a red regression for model-keyed stats aggregation; then make `px review --submit-review request-changes --message` atomically write the human outcome/findings artifacts and advance the review round alongside durable review state. Cover empty/malformed messages, persistence failure, and the subsequent implementer relaunch.

**Checkpoints:** (1) isolate both regressions with fixture tests; (2) implement model-key preservation and human artifacts; (3) exercise request-changes-to-repair lifecycle and full relevant gates.

**Stop rule:** do not merge models under an implementer-family key, and do not flip review disposition without durable artifacts that the implementer can consume.

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

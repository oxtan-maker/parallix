---
id: TASK-1357
title: >-
  Establish project Definition-of-Done defaults to enforce bug-reduction
  guardrails
status: backlog
assignee: []
created_date: '2026-06-26 18:01'
labels:
  - quality
  - guardrail
  - bug-reduction
dependencies:
  - TASK-1268
  - TASK-1353
  - TASK-1354
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The project currently has ZERO Definition-of-Done defaults (verified via definition_of_done_defaults_get → "none"), so every mission's DoD is whatever the agent improvises. Several bug-reduction guardrails belong as enforced, project-wide DoD defaults rather than per-mission prose — this is the cheapest way to make them non-optional.

Define and commit a baseline DoD default set via `definition_of_done_defaults_upsert`. Proposed items (refine before committing):
- Verification gate actually ran and passed on the final tree (proof-backed, not claimed) — see TASK-1268.
- Lint / static analysis clean on changed files — see TASK-1353.
- No focused/skipped tests (`.only` / unannotated `.skip`) introduced — see TASK-1353.
- Final checkpoint Goal Check table cites real evidence (file:line, test names) — already an execute-prompt requirement; make it a DoD default so it's enforced board-side too.
- Docs updated when workflow behavior changes (this already appears ad hoc on some tasks, e.g. TASK-1281/1306 — promote it to a default).
- For bug-labeled missions: a red→green reproduction test exists — see TASK-1354.

Care points:
- DoD defaults apply to ALL future task creation, so keep the set minimal and universally applicable; mission-specific items still go in per-task DoD (definitionOfDoneAdd), not defaults.
- Items that depend on not-yet-built enforcement (mutation ratchet, static-analysis gate) should be added as defaults only once the enforcing gate exists, so the DoD isn't aspirational/unverifiable. Sequence this after TASK-1353/1268 land, or mark such items explicitly as manual-checklist until automated.

Deliverable: an agreed default set committed to project config, plus a short note on which items are gate-enforced vs manual-checklist today.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A baseline set of project Definition-of-Done defaults is committed via definition_of_done_defaults_upsert and verifiable via definition_of_done_defaults_get
- [ ] #2 The default set is minimal and universally applicable to all missions; mission-specific items are documented to stay in per-task DoD instead
- [ ] #3 Each default item is labeled as gate-enforced or manual-checklist based on what enforcement exists today
- [ ] #4 Defaults requiring not-yet-built enforcement are either deferred until the gate lands or explicitly marked manual-checklist
- [ ] #5 A new task created after the change shows the new DoD defaults populated automatically
<!-- AC:END -->

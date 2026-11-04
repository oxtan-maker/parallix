---
id: TASK-2840
title: Restore per-command gate serialization without shared SQLite transaction races
status: done
assignee: [codex]
created_date: '2026-11-04 08:58'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 310016
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reimplement the px-0028 per-command gate resource semantics after reverting commit 0f0e6fcd8. The reverted scheduler concurrently admitted every tagged gate against the default operator-state SQLite connection, while workflow-owned verification observations used the same adapter. Lease acquisition then attempted BEGIN IMMEDIATE inside an active transaction, causing unit and integration gates to fail before their child commands launched. Preserve per-command resource capacity and descendant-lifetime release without overlapping independent transaction owners on one adapter.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Focused reproduction is red on the reverted px-0028 implementation and green on the fix: with PARALLIX_CUSTOM_ADMISSION_HOME unset, workflow authorization and verification observations enabled, multiple same-resource gates never throw BEGIN IMMEDIATE cannot nest and every admitted child records startedAt before completion.
- [ ] #2 Per-command resource capacity remains enforced within one phase and across concurrent missions; a slot is held through the command's waited descendant tree, then released before unrelated post-gate work completes.
- [ ] #3 Production-default admission storage and transaction ownership are explicit and safe. Independent lease acquisition cannot join or collide with workflow/history transactions on the cached operator adapter; cancellation, failure, polling and cleanup retain bounded behavior.
- [ ] #4 Extend the existing gate resource/admission owning suites. Do not rely only on fixtures that set PARALLIX_CUSTOM_ADMISSION_HOME to a separate database. Preserve integration-ci classification, finite CPU budgets, the 3.5 second integration-suite limit and existing operator-owned gate configuration.
- [ ] #5 Manual disposable E2E runs the built public integration gate workflow with the normal unset custom-admission-home configuration, multiple test-resource gates and workflow observations; commands launch serially, no false gate failure is recorded, leases are removed and child processes settle.
- [ ] #6 Document final user-facing resource semantics only if they differ from the restored documentation; do not add gate inventories or verification evidence to live docs.
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

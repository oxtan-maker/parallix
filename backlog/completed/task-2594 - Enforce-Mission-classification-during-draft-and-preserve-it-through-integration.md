---
id: TASK-2594
title: >-
  Enforce Mission classification during draft and preserve it through
  integration
status: done
assignee: []
created_date: '2026-09-27 15:40'
labels:
  - bug
  - ai_sdlc
  - workflow
dependencies: []
priority: high
ordinal: 125008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Require exactly one Mission classification during draft and retain it as authoritative Mission state through integration and statistics recording.

## Why

TASK-2521.07 landed at ec9ad2eea27ec036660f23c5d690b7ce4c7ff6f7 and PR #507 merged, then post-integration stats failed with missing classification. Its task file had ai_sdlc and stage stats used ai_sdlc, but the stored Mission still had only migration/workflow. Stats additionally consult deleted Backlog files for task-* identities. Operator repair restored ai_sdlc and backfilled completion stats on 2026-09-27.

## Scope

Trace classification enforcement regressions through TASK-2521.03 and later bugfixes without assuming the culprit. Add a typed, validated, expected-version Mission classification write command and draft guidance. Enforce exactly one of ai_sdlc, user_value, unknown before draft can complete/refine, preserve external-provider intake classification, and reject absent or conflicting values with actionable remediation. Use the Mission aggregate for stats across all identities, including task-* after self-hosted closeout removes the provider file. Keep a pre-landing guard and support idempotent repair of post-landing stats failures. Add red-to-green tests across native and imported Mission paths; follow ADR 0059 and classify every new integration test.

## Out of scope

* Recreating retired self-hosted Backlog or Mission metadata files.
* Reopening, re-reviewing, or re-landing completed TASK-2521.07.
* Silently assigning unknown to invalid or missing classification to bypass enforcement.
* Removing supported external Backlog provider lifecycle mirrors.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Draft cannot complete/refine with missing or multiple classification labels; native and external-provider paths enforce the same rule and explain how to repair it.
- [ ] #2 A typed Mission classification command validates ai_sdlc, user_value, unknown and expected version; draft agents use it without editing provider files.
- [ ] #3 Exactly one classification persists in the Mission aggregate across intake, draft, activation, review, integration and closeout; unrelated labels remain intact.
- [ ] #4 Integration stats read authoritative Mission classification for task-* and native identities after task-file deletion, without filesystem fallback masking stale Mission data.
- [ ] #5 Invalid classification is caught before landing; post-landing statistics recording can be repaired idempotently without reopening or re-landing the Mission.
- [ ] #6 Red-to-green reproductions cover TASK-2521.07 missing stored classification and deleted provider-file stats failure; focused tests and static analysis pass, and new integration tests are categorized per ADR 0059.
- [ ] #7 History investigation identifies evidence for the regression and live draft instructions document classification enforcement without duplicating implementation inventories.
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

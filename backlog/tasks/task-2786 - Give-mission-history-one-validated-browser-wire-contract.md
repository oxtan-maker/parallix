---
id: TASK-2786
title: Give mission history one validated browser wire contract
status: backlog
assignee: []
created_date: '2026-10-19 09:56'
labels: []
dependencies: []
ordinal: 267008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the independently maintained history wire shapes and incomplete guards in web/src/mission-history-data.ts with one shared JSON-safe contract used by the terminal history routes and browser client.

Context:
Read ADRs 0051, 0055 and 0064 and TASK-2749. Follow the existing board transport pattern while retaining the distinction between application models and browser DTOs.

Success criteria:

1. Server emission and browser parsing share the same history wire vocabulary. Required, optional and nullable fields reflect the actual contract; remove the competing browser declarations and unsafe casts that pretend partial validation established the complete shape.
2. Validate the nested fields consumed by overview, operation/history paging, search and live rendering. Responses missing required notices or probe data return the existing typed read failure instead of reaching a throwing renderer.
3. Preserve valid starting, live, ended, capture-only, missing and probe-failure states, operation/run attribution, retained history, pagination, redaction and bounded incremental reads. Preserve existing identity and transport protections.
4. Extend the owning transport/history tests with the two malformed-response regressions and representative valid payloads. Manually verify that a failed read leaves useful history visible and reports its error.
5. Keep the repair within the existing interface boundary and validation approach. No generic schema/RPC framework, second history store or unrelated polling redesign.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

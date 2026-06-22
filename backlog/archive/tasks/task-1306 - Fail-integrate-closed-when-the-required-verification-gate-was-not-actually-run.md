---
id: TASK-1306
title: Fail integrate closed when the required verification gate was not actually run
status: backlog
assignee: []
created_date: '2026-06-14 15:08'
updated_date: '2026-06-15 20:39'
labels:
  - workflow
  - parallix
  - integrate
  - guardrail
  - bug
dependencies: []
references:
  - /home/magnus/code/visualBoard-task-1299/parallix/lib/core/verification.js
  - /home/magnus/code/visualBoard-task-1299/parallix/lib/commands/integrate.js
  - /home/magnus/code/visualBoard-task-1299/parallix/lib/review/review-loop.js
priority: high
ordinal: 500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The integration path can currently proceed even when the workflow verification guard is absent or skipped, which lets an agent claim the tests were handled without a real gate run. Integration must fail closed unless the required verification gate actually executes for the changed surface, especially for workflow-code changes that are supposed to run the full suite before landing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `px integrate` or the equivalent workflow integrate path refuses to proceed when the required verification gate was skipped or missing for a change that needs it
- [ ] #2 Workflow-code changes cannot reach integration unless the full workflow verification gate actually ran and passed
- [ ] #3 A clear failure message tells the operator which gate was missing or skipped and how to run it
- [ ] #4 A regression test covers both cases: gate present and passing allows integration, gate missing or skipped blocks integration
- [ ] #5 The fix preserves existing behavior for repos or change sets that intentionally have no declared verification gate
<!-- AC:END -->

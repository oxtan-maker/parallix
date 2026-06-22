---
id: TASK-1304
title: Fix stats-backfill regex crash in workflow command registry
status: done
assignee: [claude]
created_date: '2026-06-14 15:00'
updated_date: '2026-06-15 21:24'
labels:
  - ai_sdlc
dependencies: []
references:
  - >-
    /home/magnus/code/visualBoard-task-1299/parallix/lib/commands/stats-backfill.js
priority: high
ordinal: 875
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`parallix/lib/commands/stats-backfill.js` now contains an invalid regex literal for `node parallix/index.js`, which makes the entire `parallix` command tree fail to load with a SyntaxError before unrelated commands can start. Restore the parser-safe pattern so the workflow can boot normally again.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `require('./parallix/lib/commands/stats-backfill')` loads without a SyntaxError
- [ ] #2 `node parallix rebase <slug>` can start far enough to reach the intended rebase logic
- [ ] #3 The workflow command registry still counts the `node parallix/index.js` string as a workflow pattern for stats backfill
- [ ] #4 A regression test covers loading the module or the equivalent CLI startup path
<!-- AC:END -->

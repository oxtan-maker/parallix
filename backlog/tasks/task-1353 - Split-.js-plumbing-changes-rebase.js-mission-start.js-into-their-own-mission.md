---
id: TASK-1353
title: >-
  Split .js plumbing changes (rebase.js, mission-start.js) into their own
  mission
status: backlog
assignee: []
created_date: '2026-06-26 16:44'
labels:
  - infrastructure
dependencies:
  - TASK-1350
references:
  - missions/task-1350/MISSION.md
  - >-
    missions/task-1350/review-events/2026-06-26T164341-reviewer_findings-1-claude.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The documentation-only mission task-1350 inadvertently introduced production-code changes to `lib/commands/rebase.js` and `lib/commands/mission-start.js` (plus test files) across commits d56233a7 and 0686f4a7. These changes are correct and tested but violate the Restricted Areas of task-1350 ("Do not modify any .js source files — this is a documentation-only mission").

Changes to capture in this task:
1. rebase.js: resolve and rebase onto mission's recorded base branch (resolveMissionBaseBranch) instead of always the primary branch (lib/commands/rebase.js:112-117, :578)
2. mission-start.js: rename injected runner default options.runFn || run → options.gitFn || git (lib/commands/mission-start.js:38)

Both changes are tested and appear correct. This task captures them for proper independent review as a separate feature mission, per task-1350 reviewer recommendation.
<!-- SECTION:DESCRIPTION:END -->

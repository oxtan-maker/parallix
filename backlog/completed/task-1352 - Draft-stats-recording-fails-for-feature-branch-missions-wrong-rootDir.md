---
id: TASK-1352
title: Draft stats recording fails for feature-branch missions (wrong rootDir)
status: done
assignee: [claude]
created_date: '2026-06-26 16:03'
labels:
  - ai_sdlc
dependencies: []
references:
  - 'lib/commands/draft.js:308'
  - 'lib/commands/stats.js:1218'
  - 'lib/commands/stats.js:1422'
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
During `px draft` of a feature-branch mission, the post-draft stats step emits a non-fatal warning and records nothing:

```
[WARN] Could not record draft stats for task-1350: Cannot record stage stats for task-1350: Could not resolve backlog task for task-1350.
```

Root cause: `recordDraftStats` is called with `rootDir: mainRepo` (lib/commands/draft.js:308-310). `recordStageStats` then resolves the backlog task and its classification against `mainRepo` (the primary checkout, on the primary branch). For a feature-branch mission the task file only exists on the feature branch / in the mission worktree, not in `mainRepo`/main, so resolution fails (lib/commands/stats.js:1218) and recording is skipped (stats.js:1422/1457).

This is the same class of defect already fixed for the draft preflight task lookup: feature-branch missions must resolve the task from the mission worktree, not mainRepo. The fix is to pass the mission worktree (`targetWorktree`) — or the same task-lookup root the preflight uses — as `rootDir` to `recordDraftStats`/`recordStageStats`. Confirm this does not regress primary-branch missions (where mainRepo already contains the task).

Impact: best-effort only — the draft still completes and the task still transitions (observed transition to `refined`), but draft stage stats (provider/model/tokens/tool_calls/duration) are silently dropped for every feature-branch mission, leaving telemetry gaps.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 px draft of a feature-branch mission records draft stage stats (logs 'Draft stats recorded: ...') instead of the 'Could not resolve backlog task' WARN
- [x] #2 Primary-branch missions still record stats with no regression
- [x] #3 A regression test covers draft stats recording for a feature-branch mission where the task exists only in the mission worktree
<!-- AC:END -->

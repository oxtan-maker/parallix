---
id: TASK-1375
title: 'TASK-1373: Mission 9 - Review subsystem (10 files)'
status: backlog
assignee: []
created_date: '2026-06-27 10:38'
updated_date: '2026-06-27 10:39'
labels: []
dependencies:
  - TASK-1366
  - TASK-1367
  - TASK-1368
  - TASK-1372
  - TASK-1373
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Convert the 10-file review subsystem. This handles the second-agent review phase with artifacts, state management, event tracking, polling, and prompts.

**Files renamed `.js` → `.ts`:**
- `lib/review/review.js` — review orchestrator. Imports: review-artifacts, review-commands, review-loop, review-polling
- `lib/review/review-adapter.js` (imports core/product-config, tools/forgejo)
- `lib/review/review-artifacts.js` (imports core/fmt, core/mission-utils, review-adapter, review-events, review-state)
- `lib/review/review-commands.js` (imports agents/agents, commands/handoff, core/*, review-*, tools/backlog, tools/setup-review) — **heavy aggregator**
- `lib/review/review-events.js` (imports core/fmt, core/git, core/mission-utils, review-state)
- `lib/review/review-loop.js` (imports agents/agents, agents/stage-telemetry, commands/handoff, commands/stats, core/*, review-*, tools/backlog) — **most complex review file**
- `lib/review/review-polling.js` (imports core/fmt, review-adapter)
- `lib/review/review-prompts.js` (imports core/mission-utils, review-artifacts)
- `lib/review/review-state.js` (imports core/fmt, core/git, core/mission-utils)
- `lib/review/rebase.js` (imports core/fmt, core/git, core/mission-utils, review-adapter)

**Conversion details:**
- Replace `require()` with ES `import` from converted modules
- Replace `module.exports` with ES `export`
- Preserve JSDoc annotations (good coverage, especially in review-state.js)
- Internal review imports (e.g., `import { reviewArtifacts } from './review-artifacts.js'`)
- Cross-subsystem imports: review imports from agents, commands, tools — these must be converted in their respective missions first

**Dependency:** Depends on TASK-1366, TASK-1367, TASK-1368 (core), TASK-1372 (agents), TASK-1374 (tools).
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

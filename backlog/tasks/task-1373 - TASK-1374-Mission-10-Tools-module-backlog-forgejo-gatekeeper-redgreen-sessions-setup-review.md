---
id: TASK-1373
title: >-
  TASK-1374: Mission 10 - Tools module (backlog, forgejo, gatekeeper, redgreen,
  sessions, setup-review)
status: backlog
assignee: []
created_date: '2026-06-27 10:38'
updated_date: '2026-06-27 10:38'
labels: []
dependencies:
  - TASK-1366
  - TASK-1367
  - TASK-1368
  - TASK-1372
  - TASK-1374
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Convert the 6 tools modules that integrate with external systems (backlog, Forgejo PRs, gatekeeper, redgreen testing, session management, review setup).

**Files renamed `.js` → `.ts`:**
- `lib/tools/backlog.js` (imports agents/agents, core/fmt, core/git, core/product-config)
- `lib/tools/forgejo.js` (~1500 lines) — Forgejo API client. Imports: backlog, core/fmt, core/git, core/mission-utils, core/product-config, core/verification — **largest tools file**
- `lib/tools/gatekeeper.js` (imports backlog, core/fmt, core/mission-utils, forgejo)
- `lib/tools/redgreen.js` (imports core/fmt, core/git, core/mission-utils)
- `lib/tools/sessions.js` (imports agents/agents, core/fmt, core/git, core/mission-utils, core/product-config, forgejo)
- `lib/tools/setup-review.js` (imports agents/agents, core/fmt, core/gitignore, core/product-config, forgejo)

**Conversion details:**
- Replace `require()` with ES `import` from converted modules
- Replace `module.exports` with ES `export`
- Preserve JSDoc annotations (good coverage, especially in forgejo.js)
- `forgejo.js` has extensive HTTP/API logic with many `@param`/`@returns` annotations — leverage these
- `setup-review.js` is complex with Forgejo token creation

**Dependency:** Depends on TASK-1366, TASK-1367, TASK-1368 (core), TASK-1372 (agents).
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

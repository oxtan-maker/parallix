---
id: TASK-2365
title: clean up real-agent temp dirs on signal
status: refined
assignee: [codex]
created_date: '2026-08-10 00:00'
updated_date: '2026-08-10 00:00'
labels: [bug, ai_sdlc]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`test/e2e-real-agent-smoke.test.ts` creates `parallix-real-agent-*` temp dirs via `setupRepository()` (line 356) and cleans them in a `finally` block (line 1009). The `finally` block does not run when the process is killed by SIGKILL (OOM), SIGTERM (CI timeout), or SIGINT (Ctrl+C). Each leaked dir is ~180MB. After 7 leaked runs, `/tmp` filled to 99% and blocked subsequent test runs with "temporary-storage exhaustion" assertion failure.

Add signal handlers (SIGINT, SIGTERM) that clean up all registered temp roots. Track temp dirs in a Set or registry so handlers know what to remove. SIGKILL cannot be caught — document that OOM kills still leak and recommend monitoring `/tmp` usage.
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

---
id: TASK-1392
title: deterministic launch failures should not blocklist agent families
status: backlog
assignee: []
created_date: '2026-06-30 17:51'
labels: [bug, ai_sdlc]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`startAgent()` currently writes a timed blocklist entry for any non-custom, non-limit launch failure. That conflates transient usage-limit or runtime failures with deterministic configuration/setup failures such as:

- invalid model identifiers
- auth failures
- read-only/home/bootstrap failures
- unsupported CLI flags

Observed effect: Codex can get written into `<PARALLIX_HOME>/agents.local.json` and then stay excluded from future selection even though the real problem was not a quota event.

This was introduced in commit `7725a79a1201df8d268871605419154fe813fd1e` (`mission/task-1290: task-1290`) on 2026-06-26, when the non-limit launch-failure retry path was extended to also persist a one-hour block for non-custom agents in `lib/agents/agents.js`. The later TypeScript migration commit `354999ba3a6dd8dafaf5cec2583adb06bdb23edb` on 2026-06-28 preserved the behavior in `lib/agents/agents.ts`.

Expected behavior:

- genuine usage-limit hits should still persist a timed block and reroute
- deterministic config/setup failures should reroute without poisoning the persistent blocklist
- the distinction should be regression-tested with a red-to-green reproduction
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

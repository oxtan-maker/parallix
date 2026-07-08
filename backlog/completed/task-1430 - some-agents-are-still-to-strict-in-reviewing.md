---
id: TASK-1430
title: some agents are still to strict in reviewing
status: done
assignee: [codex]
created_date: '2026-07-05 07:02'
labels: [ai_sdlc]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
we had a mission to  ensure we instruct the reviewers to review against the missions branching commit instread of latest main, but it seems we need to instruct agents more because we still waste tokens on stuff that will be fixed automatically by parallix rebasing:

example

codex commented 13 minutes ago
Collaborator
Findings
High — This branch removes the existing blocking custom-agent-smoke integration gate and the real-agent smoke test even though task-1424 is scoped to build-freshness and self-update packaging. config/integration-pipelines.json:1-18 now drops the custom-agent-smoke gate entirely, and lib/commands/integrate.ts:329-337 no longer routes custom-agent-smoke for lib/workflow changes. The diff also deletes test/e2e-real-agent-smoke.test.js, docs/real-agent-smoke.md, and the task-1359 mission artifacts that documented that protection. That is a material reduction in release coverage for the custom-agent launcher path, and it is unrelated to the mission under review. This should be restored or split into a separate, explicitly justified mission.
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

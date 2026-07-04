---
id: TASK-1388
title: Auto-send-back missing mandatory artifacts when gatekeeper blocks handoff
status: done
assignee: [claude]
created_date: '2026-06-28 11:30'
updated_date: '2026-07-04 00:00'
labels:
  - harness
  - workflow
  - ai_sdlc
dependencies:
  - TASK-1389
references:
  - docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md
  - lib/tools/gatekeeper.js
  - lib/commands/handoff.js
parent_task_id: TASK-1384
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ADR 0048 Control C5: When gatekeeper detects missing mandatory artifacts and the task strands in 'active', auto-send-back to the implementer with explicit instructions listing which artifacts to create. Relaunch agent if automated execution context is available.

Currently gatekeeper posts pushback and keeps task active (handoff.js:324-339) but does not auto-send-back to the implementer or relaunch the agent. The auto-checkpoint generation at handoff.js:103-126 already handles the most common case (missing CP-*.md), but the remaining cases are still backlog-tracked work rather than a deferred idea.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 When gatekeeper detects missing artifacts, the implementer is auto-sent-back with explicit artifact creation instructions
- [x] #2 Agent relaunch is attempted if automated execution context is available
- [x] #3 Relaunch includes a bounded retry limit to avoid loops when artifacts genuinely cannot be created
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [x] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

## Implementation Notes

### CP-1: Extended buildPushbackBody() with artifact-creation instructions
- `lib/tools/gatekeeper.ts:70-100`: Added detection for MISSION.md, CP-*.md, and backlog task file types in missing artifact list
- Generates `## Suggested artifact-creation steps:` section with specific creation guidance for each artifact type
- 4 new tests added to `test/gatekeeper.test.js` (lines 149-196)

### CP-2: Implemented bounded retry loop in handoff.ts
- `lib/commands/handoff.ts:363-423`: Built relaunch prompt with artifact creation instructions
- Implemented `while (retriesLeft > 0)` retry loop with `remainingRetries` budget (default 2)
- Added recursion guard: `if (currentAttempt > 3)` returns error immediately
- Made `runGatekeeperFn` and `attemptAgentRelaunchFn` injectable for testability
- Propagated `runGatekeeperFn` in recursive handoff call (line 402)
- 4 new tests added to `test/handoff.test.js` (lines 1143-1386)

### CP-3: Updated attemptAgentRelaunch to accept promptOverride
- `lib/commands/active.ts:320-341`: Added `promptOverride` option that bypasses relaunchability check
- When `promptOverride` is provided, uses it directly as the relaunch prompt instead of building from error message
- Handoff.ts passes `promptOverride: relaunchPrompt` to `attemptAgentRelaunchFn` (line 390)

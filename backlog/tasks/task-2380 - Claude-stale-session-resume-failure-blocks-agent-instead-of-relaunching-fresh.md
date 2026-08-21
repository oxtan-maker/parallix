---
id: TASK-2380
title: Claude stale-session resume failure blocks agent instead of relaunching fresh
status: backlog
assignee: [codex]
created_date: '2026-08-18 04:51'
labels:
  - bug
  - ai_sdlc
dependencies: []
references:
  - src/adapters/agents/claude.ts
  - src/adapters/agents/agents.ts
  - src/adapters/agents/codex.ts
  - src/adapters/agents/opencode.ts
  - test/claude.test.ts
priority: high
ordinal: 99917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mission task-2377.04 stalled because the claude agent was written into the runtime blocklist for 1 hour after a session-resume failure that should have been recovered transparently.

Observed sequence (operator log, 2026-08-18T04:41Z):

1. The execute step relaunched claude for a targeted checkpoint repair with `--resume 51a78e8c-e8bf-450f-bcdf-efe8381a670a`, taken from the `session_markers` row for `(parallix, task-2377.04, execute, claude)`.
2. The CLI exited 1 with `No conversation found with session ID: 51a78e8c-e8bf-450f-bcdf-efe8381a670a` (no transcript exists for that id; there is no `~/.claude/projects/-home-magnus-code-parallix-task-2377-04` directory at all).
3. The stale-session recovery path in `startClaudeAgent` did not fire, so the exit-1 result propagated to the generic launch-failure handler in `src/adapters/agents/agents.ts`.
4. `shouldPersistLaunchFailureBlock` classified the failure as a transient crash and wrote a 1h AgentBlock. Verified in `<PARALLIX_HOME>/parallix.db`, table `agent_blocklist`:
   `('claude', 1, '2026-08-18 07', 'exit 1: No conversation found with session ID: 51a78e8c-e8bf-450f-bcdf-efe8381a670a', '2026-08-18T04:41:08Z')`
5. Selection fell through to qwen, which then hit a real quota block, leaving the mission with no eligible implementer.

Root cause: `isStaleSessionResult` in `src/adapters/agents/claude.ts` only matches the literal string `Session not found`. The Claude CLI's actual message for a missing session is `No conversation found with session ID: <id>`, so the existing "delete the stale session marker and relaunch without --resume" recovery never triggers.

Secondary defect: even if the per-family recovery is missed, a stale-session resume error is a deterministic, agent-specific condition and must never poison the runtime blocklist. `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` in `src/adapters/agents/agents.ts` has no pattern for it.

Scope note: `src/adapters/agents/codex.ts` and `src/adapters/agents/opencode.ts` use the same narrow `Session not found` literal. Confirm each CLI's real missing-session message and align them; do not invent patterns for messages that were not verified.

Operator note: the claude block expired on its own at 2026-08-18 07:00 local; no manual unblock is required for this incident.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Claude stale-session detection matches the CLI's real missing-session message (`No conversation found with session ID: <id>`) in addition to the existing `Session not found` string, on both stdout and stderr
- [ ] #2 A resume launch that fails with a missing session deletes the stale session marker and relaunches the same agent fresh (no `--resume`), instead of failing over to another agent family
- [ ] #3 A stale-session resume failure never writes an AgentBlock entry: `shouldPersistLaunchFailureBlock` returns false for it
- [ ] #4 Codex and opencode stale-session detection is reviewed against each CLI's real missing-session message and aligned where the message was verified
- [ ] #5 Unit tests cover: stale-session relaunch triggered by the new message, marker deletion on that path, and no blocklist write for the same failure
- [ ] #6 `./scripts/verify-local.sh static-analysis` and the affected unit suites pass
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

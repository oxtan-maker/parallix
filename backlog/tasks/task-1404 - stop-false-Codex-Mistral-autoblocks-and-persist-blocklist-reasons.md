---
id: TASK-1404
title: stop false Codex/Mistral autoblocks and persist blocklist reasons
status: backlog
assignee: []
created_date: '2026-07-02 05:44'
labels:
  - bug
  - ai_sdlc
dependencies: []
references:
  - >-
    /home/magnus/code/parallix/backlog/completed/task-1392 -
    deterministic-launch-failures-should-not-blocklist-agent-families.md
  - >-
    /home/magnus/code/parallix/backlog/completed/task-1398 -
    mistral-fails-to-launch.md
  - >-
    /home/magnus/code/parallix/backlog/completed/task-1348 -
    local-blocklist-does-not-get-updated.md
documentation:
  - /home/magnus/code/parallix/lib/agents/agents.ts
  - /home/magnus/code/parallix/lib/agents/limit-hit.ts
  - /home/magnus/code/parallix/lib/agents/codex.ts
  - /home/magnus/code/parallix/lib/agents/mistral.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex and Mistral can still end up in the persistent agent blocklist even when the underlying failure is not an actual usage/quota exhaustion event. Existing fixes covered some deterministic launch failures (`task-1392`) and a specific Mistral tool-approval issue (`task-1398`), but current evidence still shows unhelpful autoblocks and poor observability.

Current evidence to ground this task:
- A live Codex probe in the current environment reaches the launcher and then fails with connectivity/runtime errors such as `failed to connect to websocket ... Operation not permitted (os error 1)` and `reachability ... required provider endpoints are unreachable over HTTP`, which are not quota events.
- Historical task evidence in `backlog/completed/task-1348 - local-blocklist-does-not-get-updated.md` shows Codex exhaustion summaries like `codex: exit 1 (OpenAI Codex v0.142.2)`, which only expose the first stderr line and hide the actionable reason.
- Mistral previously had a false-block bug fixed in `task-1398`, but the user still reports that it succeeds in draft and then gets autoblocked later in other steps, so there is still an unresolved path.
- Fresh live review-loop evidence from task-1399 shows the workflow persisting reviewer artifacts, posting the review outcome, then immediately failing the fixing-phase implementer launch with `Pinned agent "claude" is currently blocked in agents.local.json; rerouting via selectAgent for step "act-on-review".` followed by `All eligible agents exhausted for step "act-on-review". Tried: . Errors: .`
- The persisted operator blocklist at `<PARALLIX_HOME>/agents.local.json` currently records only timed `until` fields for `mistral`, `codex`, and `claude` (for example `2026-07-03 09` / `2026-07-03 11`) with no human-readable reason, source, launch stderr snippet, or originating step/mission, making it impossible to tell whether the block came from a real quota hit, a transient launcher/runtime failure, or an earlier false-positive path.
- The current shared implementation confirms that gap: `updateAgentBlock()` in `lib/agents/agents.ts` writes only `{ until }`, and the pre-launch blocked-agent reroute path in `startAgent()` logs that a pinned family is blocked but does not surface why that block exists.

This task should do two things in the same focused change:
1. Fix the remaining false-autoblock paths for Codex and Mistral in the shared blocking logic.
2. Persist a human-readable `reason` (and related source/context when appropriate) into blocklist entries whenever the workflow writes a timed block, so future incidents can be diagnosed from the blocklist file itself instead of guesswork from truncated logs.

It should also close the broader operator-observability hole exposed by the task-1399 review-loop failure: whenever parallix skips, reroutes, or exhausts an agent because that family is already blocked, the workflow must surface the persisted block reason in warnings and/or exhaustion diagnostics instead of only saying that the agent is blocked. This requirement is global to agent selection and launch handling across parallix, not limited to `act-on-review` or the review loop.

The intent is not only to reduce false blocks now, but also to leave enough on-disk evidence to debug any future provider-specific launcher failures quickly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Whenever the workflow writes a timed agent blocklist entry, the persisted entry includes a human-readable reason field that explains why the block was written, with enough detail to distinguish quota/limit hits from non-quota launch failures.
- [ ] #2 A reproduced non-quota Codex failure path does not get persisted as a false usage-style autoblock, and a regression test covers the failing stderr/output shape.
- [ ] #3 A reproduced non-quota Mistral failure path does not get persisted as a false usage-style autoblock, and a regression test covers the failing stderr/output shape.
- [ ] #4 Real usage/quota-limit hits for Codex and Mistral still persist timed blocks after the change, with tests proving that the limit-hit path remains intact.
- [ ] #5 Autoblock diagnostics exposed by logs and/or task evidence clearly show the persisted block reason so an operator can tell why Codex or Mistral is blocked without re-running the failing command.
- [ ] #6 Whenever parallix skips, reroutes, or exhausts an agent because that family is blocked, it emits a warning that includes the persisted block reason (or an explicit `unknown reason` marker if none exists yet) instead of only saying the agent is blocked.
- [ ] #7 The `act-on-review` exhaustion path from task-1399 is reproducible in a hermetic test and the fixed behavior leaves enough diagnostics to explain why the implementer/reviewer pool was exhausted.
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

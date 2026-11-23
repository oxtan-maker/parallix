---
id: TASK-2871
title: >-
  Block a family for 5 minutes, not up to 2 hours, when a provider reports
  server overload
status: done
assignee: [codex]
created_date: '2026-11-23 10:09'
labels:
  - enhancement
dependencies: []
references:
  - src/application/services/agent-limit.ts
  - src/adapters/process/failure-normalization.ts
  - src/adapters/agents/agent-launch-outcome.ts
  - src/application/services/agent-block-service.ts
  - src/adapters/agents/agent-launch-authority.ts
  - test/unit/application/services/agent-limit-detection.test.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A transient provider overload blocks the whole agent family for over an hour, which stalls every mission that uses it.

Evidence (operator workstation, 2026-11-23): two concurrent claude sessions (task-2859.21 and task-2870.01) hit `529 {"type":"overloaded_error"}` and the claude CLI exhausted its own 8 retries over a couple of minutes. The failure normalised to `provider-unavailable`, and `availabilityLimit` in `agent-limit.ts` wrote an `agent_blocklist` row for claude until the next hour boundary after now+1h (09:43Z became 11:00Z, about 77 minutes). Nothing was wrong with the account or its usage. Every claude launch was refused for the rest of that window, and the pinned-agent path reported it as "usage limit hit".

Direction: shorten the persisted block for typed `provider-unavailable` (server overload and 5xx availability errors) to 5 minutes. Applies to every family that already produces this typed failure: claude, codex, qwen, vibe and any other adapter whose launch result normalises to `provider-unavailable`. The implementer must first establish, per family, which provider overload signals reach `provider-unavailable` today (claude 529 and 5xx via `providerFailureCode` in failure-normalization.ts; codex turn.failed and error events; qwen and vibe through their own adapters) and make sure each overload code lands on that one typed reason rather than adding a parallel detection path. Do not match on provider message text.

The persisted `until` is currently an hourly local timestamp (`YYYY-MM-DD HH`) built by `formatBlockUntil`, which cannot express 5 minutes. `agentBlockState` in agent-block-service.ts already parses ISO date-times with sub-hour precision and the runtime writer `updateAgentBlockChecked` does not enforce the hourly form, so reuse that ISO form for the new block. Check every reader and display of `until` (selection, `px status`, TUI agent strip, snapshot and import paths) still handles it, and that `updateAgentBlock` in agent-config.ts, which does enforce the hourly form, is not on this path.

Also correct the pinned-agent refusal message in `handleLimitHit` (agent-launch-outcome.ts): an availability block must not be reported as "usage limit hit" or carry the `agent-quota` code.

Out of scope: `agent-quota` and usage-limit block durations, `provider-rate-limit` and `provider-entitlement` reroute behaviour, the SIGINT short block, retry counters or other new backoff machinery, parsing provider message text, gate or CPU budget changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Extend the existing agent-limit detection suite: typed provider-unavailable yields a block that expires 5 minutes after now (sub-hour ISO until), red on the parent's next-hour-boundary value and green after the change.
- [ ] #2 agent-quota blocks (structured reset, retry-after, month-end and fallback) and the SIGINT short block keep their current durations, asserted in the same suite.
- [ ] #3 Each of claude, codex, qwen and vibe has a case in its owning adapter or normalisation suite showing its documented server-overload signal normalises to provider-unavailable and so receives the 5-minute block, or an explicit note in the case why that family cannot emit it.
- [ ] #4 A persisted 5-minute block is read correctly by selection: the family is ineligible before expiry and eligible after, and px status and the TUI agent strip show the ISO expiry without error (owning suites extended, no new inventory suite).
- [ ] #5 The pinned-agent refusal for an availability block no longer says usage limit and no longer carries agent-quota; a usage block's message and code are unchanged.
- [ ] #6 Manual e2e on the operator workstation without touching real Mission data: in an isolated state dir, simulate a claude launch ending in a 529 overloaded_error, confirm the recorded block expires in about 5 minutes and that claude is selectable again afterwards.
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

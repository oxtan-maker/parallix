---
id: TASK-2416
title: Attribute the live review agent to its family in the board strip
status: done
assignee: [custom]
created_date: '2026-08-26 10:00'
labels:
  - bug
  - user_value
dependencies: []
references:
  - src/application/review-command-use-case.ts
  - src/adapters/backlog/concrete-agent-read-adapter.ts
  - src/application/projections/current-work.ts
  - src/adapters/agents/running-sessions.ts
priority: medium
---

## Description

The board strip reports running sessions correctly (e.g. `4 px cmd live`) but every
live `px review --continue` session renders as `family unknown`, and the per-family
counts read `0`. Detection of the count is fine; family attribution is not.

Attribution in `ConcreteAgentReadAdapter.loadRunningSessions` falls back to the
reconciled current-work fact's `agent` field. `px review --continue` publishes a
`running` current-work fact for its launch with `agent: null`
(`review-command-use-case.ts`, the `PUBLISHED_PHASES` entry for `start`/`continue`),
and the reconciler keeps the newest running fact per mission. That null-agent fact
shadows the real family, so a mission that is genuinely being worked by an agent
launched by Parallix (codex, claude, custom, qwen, vibe) reports `family unknown`
instead of its family.

`px review` is the ambiguous case by design: one process launches the reviewer and
then the act-on-review implementer, so a running `px review` process does not by
itself prove which family is at the keyboard. But the operation that launched the
family knows which family it is, and the current-work fact should carry it.

The intended end state:

- A mission with a live agent launched by Parallix (any family) attributes that
  family in the strip, even for the role-null `px review --continue` case.
- A mission whose only live process is Parallix doing non-agent node work
  (draft setup, integrate, handoff, resolve-conflict) still reports `family
  unknown` — that is honest, because no agent is running.
- Missions whose recording process is dead keep no blink and no family, exactly as
  today.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A live `px review --continue <slug>` whose recording process is still alive attributes the family the review loop is actually running (reviewer, then implementer) rather than `null` in the strip's per-family counts.
- [ ] #2 A mission with only a non-agent Parallix process alive (integrate / handoff / draft setup) still reports `family unknown` and does not fabricate a family.
- [ ] #3 A mission whose recording process is dead shows no blink and no family, unchanged from current behavior.
- [ ] #4 The published current-work fact for a review launch records the running family; the newest-running-fact reconciliation therefore attributes it instead of the null-agent launch summary.
- [ ] #5 Focused tests cover: live review session with a real family attributes correctly, non-agent process stays unknown, dead process stays blank.
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
